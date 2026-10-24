// Package executor provides local tools. It owns process limits, never Agent/task state or network identity.
package executor

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"sort"
)

type Server struct {
	statusBusy  chan struct{}
	commands    chan struct{}
	desktopBusy chan struct{}
	desktop     desktopDriver
}

func New(commandSlots int) (*Server, error) {
	if commandSlots < 1 || commandSlots > 16 {
		return nil, errors.New("command_slots_must_be_1_to_16")
	}
	return &Server{commands: make(chan struct{}, commandSlots), desktopBusy: make(chan struct{}, 1), statusBusy: make(chan struct{}, 1), desktop: newDesktop(runtime.GOOS, exec.LookPath, os.Getenv)}, nil
}

func decode(raw []byte, v any) error {
	if trimmed := bytes.TrimSpace(raw); len(trimmed) < 2 || trimmed[0] != '{' {
		return errors.New("invalid_arguments")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return errors.New("invalid_arguments")
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("invalid_arguments")
	}
	return nil
}

type wireRequest struct {
	Version string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "stateless MCP accepts POST only", 405)
		return
	}
	contentType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if contentType != "application/json" {
		http.Error(w, "JSON required", 415)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 128<<10))
	if err != nil {
		http.Error(w, "request too large", 413)
		return
	}
	var req wireRequest
	respond := func(result any, code int, message string) {
		w.Header().Set("Content-Type", "application/json")
		id := req.ID
		if len(id) == 0 {
			id = json.RawMessage("null")
		}
		response := map[string]any{"jsonrpc": "2.0", "id": id}
		if code != 0 {
			response["error"] = map[string]any{"code": code, "message": message}
		} else {
			response["result"] = result
		}
		_ = json.NewEncoder(w).Encode(response)
	}
	if decode(body, &req) != nil || req.Version != "2.0" {
		respond(nil, -32600, "invalid request")
		return
	}
	if len(req.ID) == 0 {
		if req.Method == "notifications/initialized" {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		// JSON-RPC 通知不能产生响应；不把缺失 id 的 tools/call 当作可执行请求。
		w.WriteHeader(http.StatusAccepted)
		return
	}
	var id any
	if json.Unmarshal(req.ID, &id) != nil {
		respond(nil, -32600, "invalid request id")
		return
	}
	switch id.(type) {
	case string, float64:
	default:
		respond(nil, -32600, "invalid request id")
		return
	}
	if len(req.Params) == 0 {
		req.Params = json.RawMessage("{}")
	}
	switch req.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string         `json:"protocolVersion"`
			Capabilities    map[string]any `json:"capabilities"`
			ClientInfo      map[string]any `json:"clientInfo"`
		}
		if decode(req.Params, &p) != nil {
			respond(nil, -32602, "invalid initialize parameters")
			return
		}
		respond(map[string]any{"protocolVersion": "2025-03-26", "capabilities": map[string]any{"tools": map[string]any{}}, "serverInfo": map[string]any{"name": "codevori-execution-node", "version": "1"}}, 0, "")
	case "ping":
		respond(map[string]any{}, 0, "")
	case "tools/list":
		respond(map[string]any{"tools": s.tools()}, 0, "")
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if decode(req.Params, &p) != nil {
			respond(nil, -32602, "invalid tool parameters")
			return
		}
		if len(p.Arguments) == 0 {
			p.Arguments = json.RawMessage("{}")
		}
		// 构建/脚本可能超过桥接器的响应头超时；先确认 HTTP 响应，再等待唯一的 JSON-RPC 结果。
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if flush, ok := w.(http.Flusher); ok {
			flush.Flush()
		}
		content, err := s.call(r.Context(), p.Name, p.Arguments)
		if err != nil {
			respond(map[string]any{"isError": true, "content": []any{map[string]any{"type": "text", "text": err.Error()}}}, 0, "")
			return
		}
		respond(map[string]any{"content": content}, 0, "")
	default:
		respond(nil, -32601, "method not found")
	}
}

func textResult(value any) []any {
	b, _ := json.Marshal(value)
	return []any{map[string]any{"type": "text", "text": string(b)}}
}

func (s *Server) call(ctx context.Context, name string, raw json.RawMessage) ([]any, error) {
	switch name {
	case "node_status":
		var args struct{}
		if decode(raw, &args) != nil {
			return nil, errors.New("invalid_arguments")
		}
		result, err := s.sampleStatus(ctx)
		if err != nil {
			return nil, err
		}
		return textResult(result), nil
	case "node_info":
		var args struct{}
		if decode(raw, &args) != nil {
			return nil, errors.New("invalid_arguments")
		}
		tools := []string{}
		for name := range s.desktop.tools {
			tools = append(tools, name)
		}
		sort.Strings(tools)
		return textResult(map[string]any{"platform": runtime.GOOS, "architecture": runtime.GOARCH, "cpuCount": runtime.NumCPU(), "commandSlots": cap(s.commands), "activeCommands": len(s.commands), "desktopBackend": s.desktop.platform, "desktopTools": tools, "desktopUnavailableReason": s.desktop.reason}), nil
	case "command_run":
		var args commandArgs
		if decode(raw, &args) != nil {
			return nil, errors.New("invalid_arguments")
		}
		result, err := s.runCommand(ctx, args)
		if err != nil {
			return nil, err
		}
		return textResult(result), nil
	}
	if !s.desktop.has(name) {
		return nil, errors.New("desktop_capability_unavailable")
	}
	// 各工具单独校验字段，避免把误传的坐标/输入静默丢弃后报告成功。
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil {
		return nil, errors.New("invalid_arguments")
	}
	allowed := map[string][]string{"desktop_screenshot": {}, "desktop_click": {"x", "y"}, "desktop_type": {"text"}, "desktop_key": {"key"}, "desktop_scroll": {"deltaY"}}[name]
	for field := range fields {
		ok := false
		for _, key := range allowed {
			ok = ok || key == field
		}
		if !ok {
			return nil, errors.New("invalid_arguments")
		}
	}
	var args desktopArgs
	if decode(raw, &args) != nil {
		return nil, errors.New("invalid_arguments")
	}
	select {
	case s.desktopBusy <- struct{}{}:
		defer func() { <-s.desktopBusy }()
	default:
		return nil, errors.New("desktop_busy")
	}
	output, err := s.desktop.perform(ctx, name, args)
	if err != nil {
		return nil, err
	}
	if name == "desktop_screenshot" {
		if len(output) > 16<<20 || !bytes.HasPrefix(output, []byte("\x89PNG\r\n\x1a\n")) {
			return nil, errors.New("screenshot_unavailable_or_too_large")
		}
		return []any{map[string]any{"type": "image", "mimeType": "image/png", "data": base64.StdEncoding.EncodeToString(output)}}, nil
	}
	return textResult(map[string]any{"dispatched": true, "observeBeforeContinuing": true}), nil
}
