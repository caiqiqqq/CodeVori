package executor

import (
	"errors"
	"strconv"
	"strings"
)

type nativeKey struct {
	windows, mac int
	x11          string
}

var namedKeys = map[string]nativeKey{
	"Enter": {13, 36, "Return"}, "Tab": {9, 48, "Tab"}, "Escape": {27, 53, "Escape"},
	"Backspace": {8, 51, "BackSpace"}, "Delete": {46, 117, "Delete"}, "Space": {32, 49, "space"},
	"ArrowLeft": {37, 123, "Left"}, "ArrowRight": {39, 124, "Right"}, "ArrowUp": {38, 126, "Up"}, "ArrowDown": {40, 125, "Down"},
	"Home": {36, 115, "Home"}, "End": {35, 119, "End"}, "PageUp": {33, 116, "Prior"}, "PageDown": {34, 121, "Next"},
}
var macLetters = []int{0, 11, 8, 2, 14, 3, 5, 4, 34, 38, 40, 37, 46, 45, 31, 35, 12, 15, 1, 17, 32, 9, 13, 7, 16, 6}
var macDigits = []int{29, 18, 19, 20, 21, 23, 22, 26, 28, 25}

// Only known key names reach native scripts or xdotool; arbitrary code never becomes a key expression.
func keyCode(value, platform string) (string, error) {
	parts := strings.Split(value, "+")
	if len(parts) > 5 {
		return "", errors.New("invalid_key")
	}
	seen := map[string]bool{}
	flags := 0
	var mods []int
	var xmods []string
	for _, m := range parts[:len(parts)-1] {
		if seen[m] {
			return "", errors.New("invalid_key")
		}
		seen[m] = true
		switch m {
		case "Ctrl":
			flags |= 1 << 18
			mods = append(mods, 17)
			xmods = append(xmods, "ctrl")
		case "Alt":
			flags |= 1 << 19
			mods = append(mods, 18)
			xmods = append(xmods, "alt")
		case "Shift":
			flags |= 1 << 17
			mods = append(mods, 16)
			xmods = append(xmods, "shift")
		case "Meta":
			flags |= 1 << 20
			mods = append(mods, 91)
			xmods = append(xmods, "super")
		default:
			return "", errors.New("invalid_key")
		}
	}
	key := parts[len(parts)-1]
	k, ok := namedKeys[key]
	if !ok && len(key) == 1 {
		c := key[0]
		if c >= 'a' && c <= 'z' {
			c -= 32
		}
		if c >= 'A' && c <= 'Z' {
			k = nativeKey{int(c), macLetters[c-'A'], strings.ToLower(string(c))}
			ok = true
		}
		if c >= '0' && c <= '9' {
			k = nativeKey{int(c), macDigits[c-'0'], string(c)}
			ok = true
		}
	}
	if !ok {
		return "", errors.New("invalid_key")
	}
	switch platform {
	case "linux":
		return strings.Join(append(xmods, k.x11), "+"), nil
	case "darwin":
		return strconv.Itoa(k.mac) + "," + strconv.Itoa(flags), nil
	case "windows":
		var script strings.Builder
		down := func(code int) {
			script.WriteString("[NodeInput]::keybd_event(" + strconv.Itoa(code) + ",0,0,[UIntPtr]::Zero);")
		}
		up := func(code int) {
			script.WriteString("[NodeInput]::keybd_event(" + strconv.Itoa(code) + ",0,2,[UIntPtr]::Zero);")
		}
		for _, code := range mods {
			down(code)
		}
		down(k.windows)
		up(k.windows)
		for i := len(mods) - 1; i >= 0; i-- {
			up(mods[i])
		}
		return script.String(), nil
	}
	return "", errors.New("invalid_key_platform")
}
