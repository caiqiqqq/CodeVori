package nodeapp

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"structs"
	"unsafe"

	"github.com/ebitengine/purego"
	"github.com/ebitengine/purego/objc"
)

type macTrayRequest struct {
	ctx     context.Context
	actions []trayAction
	done    chan struct{}
}

// Initialized once by the standalone entrypoint, before its runtime goroutine starts.
var macTrayRequests chan macTrayRequest

func startTray(ctx context.Context, dir string, installed bool, cancel context.CancelFunc) func() {
	if macTrayRequests == nil {
		return func() {}
	} // Library/test callers do not own the initial UI thread.
	request := macTrayRequest{ctx, newTrayActions(dir, installed, cancel), make(chan struct{})}
	select {
	case macTrayRequests <- request:
		return func() { cancel(); <-request.done }
	case <-ctx.Done():
		return func() {}
	}
}

// DesktopMain pumps only native presentation on the initial thread. Main remains the runtime owner.
func DesktopMain(args []string) error {
	macTrayRequests = make(chan macTrayRequest)
	result := make(chan error, 1)
	go func() { result <- Main(args) }()
	select {
	case err := <-result:
		return err
	case request := <-macTrayRequests:
		if err := runMacTray(request); err != nil {
			fmt.Fprintln(os.Stderr, "CodeVori Node menu bar unavailable:", err)
		}
		close(request.done)
		return <-result
	}
}

func nsString(text string) objc.ID {
	return objc.ID(objc.GetClass("NSString")).Send(objc.RegisterName("stringWithUTF8String:"), text)
}

func runMacTray(request macTrayRequest) error {
	if _, err := purego.Dlopen("/System/Library/Frameworks/AppKit.framework/AppKit", purego.RTLD_GLOBAL|purego.RTLD_LAZY); err != nil {
		return err
	}
	pool := objc.ID(objc.GetClass("NSAutoreleasePool")).Send(objc.RegisterName("new"))
	defer pool.Send(objc.RegisterName("drain"))
	app := objc.ID(objc.GetClass("NSApplication")).Send(objc.RegisterName("sharedApplication"))
	app.Send(objc.RegisterName("setActivationPolicy:"), int64(1)) // Accessory: menu bar, no Dock window.
	app.Send(objc.RegisterName("finishLaunching"))
	class, err := objc.RegisterClass("CodeVoriNodeTrayActions", objc.GetClass("NSObject"), nil, nil, []objc.MethodDef{{
		Cmd: objc.RegisterName("activate:"),
		Fn: func(_ objc.ID, _ objc.SEL, sender objc.ID) {
			index := objc.Send[int64](sender, objc.RegisterName("tag"))
			if index >= 0 && index < int64(len(request.actions)) {
				invokeTrayAction(request.actions[index])
			}
		},
	}})
	if err != nil {
		return err
	}
	target := objc.ID(class).Send(objc.RegisterName("new"))
	defer target.Send(objc.RegisterName("release"))
	bar := objc.ID(objc.GetClass("NSStatusBar")).Send(objc.RegisterName("systemStatusBar"))
	item := bar.Send(objc.RegisterName("statusItemWithLength:"), float64(26))
	if item == 0 {
		return fmt.Errorf("status_item_unavailable")
	}
	defer bar.Send(objc.RegisterName("removeStatusItem:"), item)
	button := item.Send(objc.RegisterName("button"))
	data := objc.ID(objc.GetClass("NSData")).Send(objc.RegisterName("dataWithBytes:length:"), unsafe.Pointer(&nodeTrayPNG[0]), uintptr(len(nodeTrayPNG)))
	runtime.KeepAlive(nodeTrayPNG)
	image := objc.ID(objc.GetClass("NSImage")).Send(objc.RegisterName("alloc")).Send(objc.RegisterName("initWithData:"), data)
	defer image.Send(objc.RegisterName("release"))
	image.Send(objc.RegisterName("setSize:"), struct {
		_             structs.HostLayout
		Width, Height float64
	}{Width: 18, Height: 18})
	button.Send(objc.RegisterName("setImage:"), image)
	button.Send(objc.RegisterName("setToolTip:"), nsString("CodeVori Node · 打开状态查看连接"))
	button.Send(objc.RegisterName("setAccessibilityLabel:"), nsString("CodeVori Node"))
	menu := objc.ID(objc.GetClass("NSMenu")).Send(objc.RegisterName("alloc")).Send(objc.RegisterName("initWithTitle:"), nsString("CodeVori Node"))
	defer menu.Send(objc.RegisterName("release"))
	for index, action := range request.actions {
		entry := objc.ID(objc.GetClass("NSMenuItem")).Send(objc.RegisterName("alloc")).Send(objc.RegisterName("initWithTitle:action:keyEquivalent:"), nsString(action.label), objc.RegisterName("activate:"), nsString(""))
		entry.Send(objc.RegisterName("setTarget:"), target)
		entry.Send(objc.RegisterName("setTag:"), int64(index))
		menu.Send(objc.RegisterName("addItem:"), entry)
		entry.Send(objc.RegisterName("release"))
	}
	item.Send(objc.RegisterName("setMenu:"), menu)
	// 有限事件等待让原有 context 取消能回到初始线程移除图标，无另一个生命周期所有者。
	for request.ctx.Err() == nil {
		cycle := objc.ID(objc.GetClass("NSAutoreleasePool")).Send(objc.RegisterName("new"))
		until := objc.ID(objc.GetClass("NSDate")).Send(objc.RegisterName("dateWithTimeIntervalSinceNow:"), float64(0.05))
		event := app.Send(objc.RegisterName("nextEventMatchingMask:untilDate:inMode:dequeue:"), ^uint64(0), until, nsString("kCFRunLoopDefaultMode"), true)
		if event != 0 {
			app.Send(objc.RegisterName("sendEvent:"), event)
		}
		cycle.Send(objc.RegisterName("drain"))
	}
	return nil
}
