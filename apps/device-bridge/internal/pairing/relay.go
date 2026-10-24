package pairing

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const maxReply = 24 << 20

// Packet carries a transient request association, never a queued task or replay cursor.
type Packet struct {
	ID     string          `json:"id"`
	Kind   string          `json:"kind"`
	Status int             `json:"status,omitempty"`
	Body   json.RawMessage `json:"body,omitempty"`
}
type link struct {
	generation string
	conn       *websocket.Conn
	ctx        context.Context
	cancel     context.CancelFunc
	mu         sync.Mutex
	pending    map[string]chan Packet
}

func (l *link) close() { l.cancel(); _ = l.conn.CloseNow() }
func writePacket(ctx context.Context, c *websocket.Conn, p Packet) error {
	b, e := json.Marshal(p)
	if e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return c.Write(ctx, websocket.MessageText, b)
}
func (s *Server) socket(w http.ResponseWriter, r *http.Request, id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.records[id]
	bearer := r.Header.Get("Authorization")
	if p == nil || !strings.HasPrefix(bearer, "Bearer ") || digest(strings.TrimPrefix(bearer, "Bearer ")) != p.NodeHash {
		reply(w, 401, nil)
		return
	}
	if s.links[id] != nil {
		reply(w, 409, nil)
		return
	}
	c, e := websocket.Accept(w, r, nil)
	if e != nil {
		return
	}
	c.SetReadLimit(maxReply)
	ctx, cancel := context.WithCancel(context.Background())
	l := &link{generation: token(), conn: c, ctx: ctx, cancel: cancel, pending: map[string]chan Packet{}}
	s.links[id] = l
	go func() {
		defer func() {
			l.close()
			s.mu.Lock()
			if s.links[id] == l {
				delete(s.links, id)
			}
			s.mu.Unlock()
		}()
		go func() {
			ticker := time.NewTicker(20 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					ping, stop := context.WithTimeout(ctx, 10*time.Second)
					err := c.Ping(ping)
					stop()
					if err != nil {
						l.close()
						return
					}
				}
			}
		}()
		for {
			_, b, err := c.Read(ctx)
			if err != nil {
				return
			}
			var packet Packet
			if json.Unmarshal(b, &packet) != nil || packet.Kind != "response" || packet.Status < 200 || packet.Status > 599 {
				return
			}
			l.mu.Lock()
			ch := l.pending[packet.ID]
			if ch != nil {
				select {
				case ch <- packet:
				default:
				}
			}
			l.mu.Unlock()
		}
	}()
}
func (s *Server) forward(w http.ResponseWriter, r *http.Request, l *link) {
	b, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 128<<10))
	if e != nil {
		reply(w, 413, nil)
		return
	}
	if !json.Valid(b) {
		reply(w, 400, nil)
		return
	}
	id := token()
	ch := make(chan Packet, 1)
	l.mu.Lock()
	if len(l.pending) >= 32 {
		l.mu.Unlock()
		reply(w, 429, nil)
		return
	}
	l.pending[id] = ch
	l.mu.Unlock()
	defer func() { l.mu.Lock(); delete(l.pending, id); l.mu.Unlock() }()
	ctx, cancel := context.WithTimeout(r.Context(), 610*time.Second)
	defer cancel()
	if writePacket(ctx, l.conn, Packet{ID: id, Kind: "request", Body: b}) != nil {
		reply(w, 502, map[string]string{"error": "operation_outcome_unknown"})
		return
	}
	select {
	case packet := <-ch:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(packet.Status)
		_, _ = w.Write(packet.Body)
	case <-l.ctx.Done():
		reply(w, 502, map[string]string{"error": "operation_outcome_unknown"})
	case <-ctx.Done():
		_ = writePacket(l.ctx, l.conn, Packet{ID: id, Kind: "cancel"})
		reply(w, 504, map[string]string{"error": "operation_outcome_unknown"})
	}
}

type capture struct {
	header   http.Header
	status   int
	body     bytes.Buffer
	overflow bool
}

func (c *capture) Header() http.Header { return c.header }
func (c *capture) WriteHeader(n int) {
	if c.status == 0 {
		c.status = n
	}
}
func (c *capture) Flush() {}
func (c *capture) Write(b []byte) (int, error) {
	if c.status == 0 {
		c.status = 200
	}
	if c.body.Len()+len(b) > maxReply-1024 {
		c.overflow = true
		return len(b), nil
	}
	return c.body.Write(b)
}

// ServeExecutor executes once per live transport request. Losing the socket cancels all executions.
func ServeExecutor(parent context.Context, c *websocket.Conn, handler http.Handler) error {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	defer c.CloseNow()
	c.SetReadLimit(256 << 10)
	var mu sync.Mutex
	running := map[string]context.CancelFunc{}
	var wg sync.WaitGroup
	defer func() { cancel(); wg.Wait() }()
	for {
		_, b, e := c.Read(ctx)
		if e != nil {
			return e
		}
		var p Packet
		if json.Unmarshal(b, &p) != nil || !credential.MatchString(p.ID) {
			continue
		}
		mu.Lock()
		if p.Kind == "cancel" {
			if stop := running[p.ID]; stop != nil {
				stop()
			}
			mu.Unlock()
			continue
		}
		if p.Kind != "request" || !json.Valid(p.Body) {
			mu.Unlock()
			continue
		}
		if _, exists := running[p.ID]; exists {
			mu.Unlock()
			continue
		}
		if len(running) >= 32 {
			mu.Unlock()
			_ = writePacket(ctx, c, Packet{ID: p.ID, Kind: "response", Status: 429})
			continue
		}
		op, stop := context.WithCancel(ctx)
		running[p.ID] = stop
		mu.Unlock()
		wg.Add(1)
		go func(p Packet) {
			defer wg.Done()
			defer stop()
			defer func() { mu.Lock(); delete(running, p.ID); mu.Unlock() }()
			req, _ := http.NewRequestWithContext(op, "POST", "http://127.0.0.1/mcp", bytes.NewReader(p.Body))
			req.Header.Set("Content-Type", "application/json")
			out := &capture{header: make(http.Header)}
			handler.ServeHTTP(out, req)
			if out.status == 0 {
				out.status = 200
			}
			body := out.body.Bytes()
			if out.overflow {
				out.status = 502
				body = []byte(`{"error":"response_too_large"}`)
			}
			if !json.Valid(body) {
				body = nil
			}
			_ = writePacket(ctx, c, Packet{ID: p.ID, Kind: "response", Status: out.status, Body: body})
		}(p)
	}
}
