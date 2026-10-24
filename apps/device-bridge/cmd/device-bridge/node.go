package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net"
	"net/http"
	"time"

	"zcode.local/device-bridge/internal/bridge"
	"zcode.local/device-bridge/internal/executor"
)

// runNode composes the same authenticated transport with local tools; no Desktop/Agent runtime.
func runNode(ctx context.Context, c bridge.Config, stdout, stderr io.Writer) error {
	return runNodeWithBridge(ctx, c, stdout, stderr, bridge.Run)
}

func runNodeWithBridge(ctx context.Context, c bridge.Config, stdout, stderr io.Writer, run func(context.Context, bridge.Config, io.Writer, io.Writer) error) error {
	if err := c.Validate(); err != nil {
		return err
	}
	handler, err := executor.New(c.CommandSlots)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return errors.New("node_loopback_unavailable")
	}
	defer listener.Close()
	secret := make([]byte, 32)
	if _, err = rand.Read(secret); err != nil {
		return errors.New("node_credential_unavailable")
	}
	c.TargetToken = hex.EncodeToString(secret)
	c.Target = "http://" + listener.Addr().String() + "/mcp"
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	server := &http.Server{Handler: bridge.Endpoint(bridge.LocalGateway(c.TargetToken, handler)), ReadHeaderTimeout: 10 * time.Second, BaseContext: func(net.Listener) context.Context { return ctx }}
	defer server.Close()
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener); cancel() }()
	err = run(ctx, c, stdout, stderr)
	select {
	case localErr := <-done:
		if localErr != nil && !errors.Is(localErr, http.ErrServerClosed) {
			return errors.New("node_executor_listener_failed")
		}
	default:
	}
	return err
}
