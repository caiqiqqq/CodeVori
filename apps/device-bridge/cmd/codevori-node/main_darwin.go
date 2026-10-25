package main

import (
	"runtime"
	"zcode.local/device-bridge/internal/nodeapp"
)

// AppKit 必须留在进程的初始线程；网络和安装命令仍由原有 Main 管理。
func init()                       { runtime.LockOSThread() }
func runMain(args []string) error { return nodeapp.DesktopMain(args) }
