//go:build !windows && !darwin && !linux

package nodeapp

import "context"

func startTray(context.Context, string, bool, context.CancelFunc) func() { return func() {} }
