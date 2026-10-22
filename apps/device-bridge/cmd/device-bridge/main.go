package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"

	"zcode.local/device-bridge/internal/bridge"
)

type nodeFlags []string

func (v *nodeFlags) String() string     { return "" }
func (v *nodeFlags) Set(s string) error { *v = append(*v, s); return nil }

func parse(args []string, stderr io.Writer, getenv func(string) string) (bridge.Config, error) {
	var c bridge.Config
	if len(args) == 0 || (args[0] != "manage" && args[0] != "identity" && args[0] != "serve" && args[0] != "connect") {
		fmt.Fprintln(stderr, "usage: device-bridge <manage|identity|serve|connect> --state-dir <absolute> --hostname <name> [options]\nRun device-bridge serve --help or connect --help for options.")
		if len(args) > 0 && (args[0] == "--help" || args[0] == "-h") {
			return c, flag.ErrHelp
		}
		return c, errors.New("manage, identity, serve or connect is required")
	}
	c.Mode = args[0]
	flags := flag.NewFlagSet(c.Mode, flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.StringVar(&c.StateDir, "state-dir", "", "absolute path for this node's private tsnet state")
	flags.StringVar(&c.Hostname, "hostname", "", "unique tailnet node name")
	var allowed nodeFlags
	var targetTokenEnv string
	if c.Mode == "serve" {
		flags.IntVar(&c.Port, "port", 8743, "tailnet listening port")
		flags.StringVar(&c.Target, "target", "http://127.0.0.1:8000/mcp", "fixed local HTTP MCP endpoint")
		flags.Var(&allowed, "allow-node", "authorized stable client node ID (repeat for multiple clients)")
		flags.StringVar(&targetTokenEnv, "target-token-env", "", "environment variable holding upstream MCP bearer token")
	} else if c.Mode == "connect" {
		flags.StringVar(&c.Listen, "listen", "127.0.0.1:18743", "local IPv4 loopback address; port 0 selects a free port")
		flags.StringVar(&c.Peer, "peer", "", "tailnet endpoint host:port")
		flags.StringVar(&c.PeerNode, "peer-node", "", "expected stable server node ID")
	}
	if err := flags.Parse(args[1:]); err != nil {
		return c, err
	}
	if flags.NArg() != 0 {
		return c, errors.New("unexpected positional arguments")
	}
	c.AllowedNodes = allowed
	if c.Mode == "connect" {
		c.LocalToken = getenv("ZCODE_DEVICE_BRIDGE_TOKEN")
	}
	if targetTokenEnv != "" {
		c.TargetToken = getenv(targetTokenEnv)
		if c.TargetToken == "" {
			return c, errors.New("target token environment variable is empty")
		}
	}
	return c, c.Validate()
}

func main() {
	c, err := parse(os.Args[1:], os.Stderr, os.Getenv)
	if errors.Is(err, flag.ErrHelp) {
		return
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if c.Mode == "manage" {
		if err := bridge.Manage(ctx, c, os.Stdin, os.Stdout); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if err := bridge.Run(ctx, c, os.Stdout, os.Stderr); err != nil {
		if ctx.Err() != nil {
			return
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
