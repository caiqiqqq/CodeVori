package executor

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

type commandArgs struct {
	Command        string `json:"command"`
	Cwd            string `json:"cwd"`
	TimeoutSeconds int    `json:"timeoutSeconds,omitempty"`
}

type commandResult struct {
	ExitCode  int    `json:"exitCode"`
	Stdout    string `json:"stdout"`
	Stderr    string `json:"stderr"`
	Truncated bool   `json:"truncated"`
}

type limitedBuffer struct {
	bytes.Buffer
	limit     int
	truncated bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	remaining := b.limit - b.Len()
	if len(p) > remaining {
		p = p[:remaining]
		b.truncated = true
	}
	b.Buffer.Write(p)
	return n, nil
}

func (s *Server) runCommand(ctx context.Context, a commandArgs) (commandResult, error) {
	var result commandResult
	if a.Command == "" || len(a.Command) > 16384 || !filepath.IsAbs(a.Cwd) || a.TimeoutSeconds < 0 || a.TimeoutSeconds > 600 {
		return result, errors.New("invalid_command_arguments")
	}
	info, err := os.Stat(a.Cwd)
	if err != nil || !info.IsDir() {
		return result, errors.New("command_directory_unavailable")
	}
	select {
	case s.commands <- struct{}{}:
		defer func() { <-s.commands }()
	default:
		return result, errors.New("node_busy")
	}
	if a.TimeoutSeconds == 0 {
		a.TimeoutSeconds = 60
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(a.TimeoutSeconds)*time.Second)
	defer cancel()
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		encoded := encodePowerShell("[Console]::OutputEncoding=[Text.Encoding]::UTF8;" + a.Command)
		if len(encoded) > 30000 {
			return result, errors.New("command_too_large")
		}
		cmd = exec.CommandContext(ctx, "powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded)
	} else {
		cmd = exec.CommandContext(ctx, "/bin/sh", "-c", a.Command)
	}
	cmd.Dir = a.Cwd
	stdout, stderr := &limitedBuffer{limit: 65536}, &limitedBuffer{limit: 65536}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	cleanup := prepareProcess(cmd)
	defer cleanup()
	err = cmd.Run()
	if ctx.Err() != nil {
		return result, errors.New("command_cancelled_or_timed_out")
	}
	result = commandResult{0, stdout.String(), stderr.String(), stdout.truncated || stderr.truncated}
	if err != nil {
		var exit *exec.ExitError
		if !errors.As(err, &exit) {
			return result, errors.New("command_start_failed")
		}
		result.ExitCode = exit.ExitCode()
	}
	return result, nil
}

// runAction never includes process stderr in diagnostics: native errors may contain typed text.
func runAction(ctx context.Context, p actionPlan) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, p.program, p.args...)
	output := &limitedBuffer{limit: 24 << 20}
	cmd.Stdout, cmd.Stderr = output, io.Discard
	cleanup := prepareProcess(cmd)
	defer cleanup()
	if err := cmd.Run(); err != nil || output.truncated {
		return nil, errors.New("desktop_operation_failed_check_permissions_and_session")
	}
	return output.Bytes(), nil
}
