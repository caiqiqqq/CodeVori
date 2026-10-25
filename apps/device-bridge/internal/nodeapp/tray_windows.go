//go:build windows

package nodeapp

import (
	"context"
	"runtime"
	"syscall"
	"unsafe"
)

type trayClass struct {
	Size, Style                        uint32
	Proc                               uintptr
	ClassExtra, WindowExtra            int32
	Instance, Icon, Cursor, Background uintptr
	Menu, Name                         *uint16
	SmallIcon                          uintptr
}
type trayData struct {
	Size               uint32
	Window             uintptr
	ID, Flags, Message uint32
	Icon               uintptr
	Tip                [128]uint16
	State, StateMask   uint32
	Info               [256]uint16
	Version            uint32
	Title              [64]uint16
	InfoFlags          uint32
	GUID               [16]byte
	BalloonIcon        uintptr
}
type point struct{ X, Y int32 }
type trayMessage struct {
	Window         uintptr
	Message        uint32
	WParam, LParam uintptr
	Time           uint32
	Point          point
	Private        uint32
}

func startTray(ctx context.Context, dir string, installed bool, cancel context.CancelFunc) func() {
	done := make(chan struct{})
	go func() {
		defer close(done)
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		shell32 := syscall.NewLazyDLL("shell32.dll")
		name, _ := syscall.UTF16PtrFromString("CodeVoriNodeTray")
		actions := newTrayActions(dir, installed, cancel)
		taskbarName, _ := syscall.UTF16PtrFromString("TaskbarCreated")
		taskbarCreated, _, _ := user32.NewProc("RegisterWindowMessageW").Call(uintptr(unsafe.Pointer(taskbarName)))
		var data trayData
		callback := syscall.NewCallback(func(window uintptr, msg uint32, wp, lp uintptr) uintptr {
			// Explorer 重启会清空托盘；复用进程内图标和窗口，避免运行中入口丢失。
			if taskbarCreated != 0 && uintptr(msg) == taskbarCreated && data.Window != 0 {
				shell32.NewProc("Shell_NotifyIconW").Call(0, uintptr(unsafe.Pointer(&data)))
				return 0
			}
			switch msg {
			case 0x8001:
				if lp == 0x203 {
					invokeTrayAction(actions[0])
				}
				if lp == 0x205 {
					menu, _, _ := user32.NewProc("CreatePopupMenu").Call()
					for index, action := range actions {
						label, _ := syscall.UTF16PtrFromString(action.label)
						user32.NewProc("AppendMenuW").Call(menu, 0, uintptr(index+1), uintptr(unsafe.Pointer(label)))
					}
					var p point
					user32.NewProc("GetCursorPos").Call(uintptr(unsafe.Pointer(&p)))
					user32.NewProc("SetForegroundWindow").Call(window)
					choice, _, _ := user32.NewProc("TrackPopupMenu").Call(menu, 0x102, uintptr(p.X), uintptr(p.Y), 0, window, 0)
					user32.NewProc("DestroyMenu").Call(menu)
					if choice > 0 && choice <= uintptr(len(actions)) {
						invokeTrayAction(actions[choice-1])
					}
				}
				return 0
			case 0x0010:
				shell32.NewProc("Shell_NotifyIconW").Call(2, uintptr(unsafe.Pointer(&data)))
				user32.NewProc("DestroyWindow").Call(window)
				return 0
			case 0x0002:
				user32.NewProc("PostQuitMessage").Call(0)
				return 0
			}
			ret, _, _ := user32.NewProc("DefWindowProcW").Call(window, uintptr(msg), wp, lp)
			return ret
		})
		instance, _, _ := syscall.NewLazyDLL("kernel32.dll").NewProc("GetModuleHandleW").Call(0)
		// 使用安装包的多分辨率图标；开发时没有 PE 资源则从内嵌 ICO 解码。
		icon := loadNodeTrayIcon(instance)
		if icon == 0 {
			return
		}
		defer user32.NewProc("DestroyIcon").Call(icon)
		class := trayClass{Proc: callback, Instance: instance, Name: name, Icon: icon, SmallIcon: icon}
		class.Size = uint32(unsafe.Sizeof(class))
		user32.NewProc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&class)))
		defer user32.NewProc("UnregisterClassW").Call(uintptr(unsafe.Pointer(name)), instance)
		window, _, _ := user32.NewProc("CreateWindowExW").Call(0, uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(name)), 0, 0, 0, 0, 0, 0, 0, instance, 0)
		if window == 0 {
			return
		}
		data = trayData{Window: window, ID: 1, Flags: 7, Message: 0x8001, Icon: icon}
		data.Size = uint32(unsafe.Sizeof(data))
		copy(data.Tip[:], syscall.StringToUTF16("CodeVori Node"))
		shell32.NewProc("Shell_NotifyIconW").Call(0, uintptr(unsafe.Pointer(&data)))
		go func() { <-ctx.Done(); user32.NewProc("PostMessageW").Call(window, 0x0010, 0, 0) }()
		var message trayMessage
		for {
			n, _, _ := user32.NewProc("GetMessageW").Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
			if int32(n) <= 0 {
				return
			}
			user32.NewProc("TranslateMessage").Call(uintptr(unsafe.Pointer(&message)))
			user32.NewProc("DispatchMessageW").Call(uintptr(unsafe.Pointer(&message)))
		}
	}()
	return func() { cancel(); <-done }
}
