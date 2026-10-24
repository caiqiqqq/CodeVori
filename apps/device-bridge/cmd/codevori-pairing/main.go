package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"zcode.local/device-bridge/internal/pairing"
)

func main() {
	s, e := pairing.New(pairing.Config{StateDir: os.Getenv("CODEVORI_PAIRING_STATE_DIR"), PublicURL: os.Getenv("CODEVORI_NODE_SERVICE_URL"), AssetsDir: os.Getenv("CODEVORI_NODE_ASSETS_DIR"), AssetsURL: os.Getenv("CODEVORI_NODE_ASSETS_URL")})
	if e != nil {
		fmt.Fprintln(os.Stderr, "pairing configuration/state unavailable")
		os.Exit(1)
	}
	defer s.Close()
	addr := os.Getenv("CODEVORI_PAIRING_LISTEN")
	if addr == "" {
		addr = "127.0.0.1:18081"
	}
	server := &http.Server{Addr: addr, Handler: s, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		s.Close()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	if e = server.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, "pairing listener failed")
		os.Exit(1)
	}
}
