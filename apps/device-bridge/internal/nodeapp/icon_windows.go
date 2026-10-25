//go:build windows

package nodeapp

import (
	_ "embed"
	"encoding/binary"
	"unsafe"
)

//go:embed assets/icon.ico
var nodeIconICO []byte

func loadNodeTrayIcon(instance uintptr) uintptr {
	size, _, _ := user32.NewProc("GetSystemMetrics").Call(49) // SM_CXSMICON, respects system scaling.
	if size == 0 {
		size = 16
	}
	icon, _, _ := user32.NewProc("LoadImageW").Call(instance, 1, 1, size, size, 0)
	if icon != 0 {
		return icon
	}
	// go run / 未打包开发构建同样显示品牌图标，不回退成系统默认应用。
	data := nodeIconICO
	if len(data) < 6 {
		return 0
	}
	count := int(binary.LittleEndian.Uint16(data[4:6]))
	if count == 0 || 6+count*16 > len(data) {
		return 0
	}
	entry, distance := 6, 10000
	for offset := 6; offset < 6+count*16; offset += 16 {
		width := int(data[offset])
		if width == 0 {
			width = 256
		}
		delta := width - int(size)
		if delta < 0 {
			delta = -delta
		}
		if delta < distance {
			entry, distance = offset, delta
		}
	}
	length := uint64(binary.LittleEndian.Uint32(data[entry+8 : entry+12]))
	start := uint64(binary.LittleEndian.Uint32(data[entry+12 : entry+16]))
	if length == 0 || start+length > uint64(len(data)) {
		return 0
	}
	icon, _, _ = user32.NewProc("CreateIconFromResourceEx").Call(uintptr(unsafe.Pointer(&data[start])), uintptr(length), 1, 0x30000, size, size, 0)
	return icon
}
