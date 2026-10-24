package main

import (
	"flag"
	"io"
	"strings"
	"testing"
)

func TestParseBeforeAnyNetworkOrStateIO(t *testing.T) {
	state := t.TempDir()
	base := []string{"--state-dir", state, "--hostname", "example-node"}
	for _, tc := range []struct {
		name string
		args []string
		env  string
		ok   bool
	}{
		{"identity", append([]string{"identity"}, base...), "", true},
		{"serve", append(append([]string{"serve"}, base...), "--allow-node", "client-node"), "", true},
		{"builtin node", append(append([]string{"node"}, base...), "--allow-node", "client-node", "--command-slots", "2"), "", true},
		{"node without authorization", append([]string{"node"}, base...), "", false},
		{"node invalid capacity", append(append([]string{"node"}, base...), "--allow-node", "client-node", "--command-slots", "0"), "", false},
		{"missing allowlist", append([]string{"serve"}, base...), "", false},
		{"connect", append(append([]string{"connect"}, base...), "--peer", "windows.example.ts.net:8743", "--peer-node", "server-node"), strings.Repeat("x", 32), true},
		{"missing token", append(append([]string{"connect"}, base...), "--peer", "windows:8743", "--peer-node", "server-node"), "", false},
		{"missing node", append(append([]string{"connect"}, base...), "--peer", "windows:8743"), strings.Repeat("x", 32), false},
		{"target credential", append(append([]string{"serve"}, base...), "--target", "http://secret:password@127.0.0.1/mcp", "--allow-node", "client"), "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := parse(tc.args, io.Discard, func(string) string { return tc.env })
			if (err == nil) != tc.ok {
				t.Fatalf("parse error: %v", err)
			}
			if err != nil && strings.Contains(err.Error(), "password") {
				t.Fatal("credential leaked")
			}
		})
	}
	if _, err := parse([]string{"--help"}, io.Discard, func(string) string { return "" }); err != flag.ErrHelp {
		t.Fatal(err)
	}
}
