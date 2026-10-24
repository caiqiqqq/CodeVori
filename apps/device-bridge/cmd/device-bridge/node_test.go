package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"zcode.local/device-bridge/internal/bridge"
)

func TestNodeComposesPrivateExecutorWithExistingTransport(t *testing.T) {
	c, err := parse([]string{"node", "--state-dir", t.TempDir(), "--hostname", "synthetic", "--allow-node", "controller"}, io.Discard, func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	var url string
	err = runNodeWithBridge(context.Background(), c, io.Discard, io.Discard, func(ctx context.Context, c bridge.Config, _, _ io.Writer) error {
		url = c.Target
		if c.Mode != "node" || len(c.TargetToken) != 64 {
			t.Fatal("transport or local credentials changed")
		}
		request := func(token string) *http.Response {
			r, _ := http.NewRequestWithContext(ctx, "POST", c.Target, strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`))
			r.Header.Set("Content-Type", "application/json")
			if token != "" {
				r.Header.Set("Authorization", "Bearer "+token)
			}
			response, err := http.DefaultClient.Do(r)
			if err != nil {
				t.Fatal(err)
			}
			return response
		}
		response := request("")
		response.Body.Close()
		if response.StatusCode != 401 {
			t.Fatal("private executor is unprotected")
		}
		response = request(c.TargetToken)
		defer response.Body.Close()
		var result struct {
			Result struct {
				Tools []struct {
					Name string `json:"name"`
				} `json:"tools"`
			} `json:"result"`
		}
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		if len(result.Result.Tools) < 2 || result.Result.Tools[0].Name != "node_info" {
			t.Fatal("native tools unavailable through transport")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	response, err := http.Get(url)
	if err == nil {
		response.Body.Close()
		t.Fatal("node left a listener after transport stopped")
	}
}
