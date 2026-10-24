package executor

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"strings"
	"unicode/utf16"
)

type desktopArgs struct {
	X      *int   `json:"x,omitempty"`
	Y      *int   `json:"y,omitempty"`
	Text   string `json:"text,omitempty"`
	Key    string `json:"key,omitempty"`
	DeltaY int    `json:"deltaY,omitempty"`
}

type actionPlan struct {
	program     string
	args        []string
	base64Image bool
}
type desktopDriver struct {
	platform, reason string
	tools            map[string]bool
	execute          func(context.Context, actionPlan) ([]byte, error)
}

func newDesktop(platform string, look func(string) (string, error), getenv func(string) string) desktopDriver {
	d := desktopDriver{platform: platform, tools: map[string]bool{}, execute: runAction}
	has := func(name string) bool { _, err := look(name); return err == nil }
	input, screenshot := false, false
	switch platform {
	case "windows":
		input = has("powershell.exe")
		screenshot = input
	case "darwin":
		input = has("osascript")
		screenshot = has("screencapture") && has("osascript") && has("sips")
	case "linux":
		if strings.EqualFold(getenv("XDG_SESSION_TYPE"), "wayland") || getenv("WAYLAND_DISPLAY") != "" {
			d.reason = "wayland_not_supported"
			return d
		}
		if getenv("DISPLAY") == "" {
			d.reason = "interactive_display_unavailable"
			return d
		}
		input = has("xdotool")
		screenshot = has("import")
	default:
		d.reason = "desktop_platform_not_supported"
		return d
	}
	if input {
		for _, tool := range []string{"desktop_click", "desktop_type", "desktop_key", "desktop_scroll"} {
			d.tools[tool] = true
		}
	}
	if screenshot {
		d.tools["desktop_screenshot"] = true
	}
	if !input || !screenshot {
		d.reason = "desktop_dependencies_missing"
	}
	return d
}

func (d desktopDriver) has(name string) bool { return d.tools[name] }

func encodePowerShell(script string) string {
	u := utf16.Encode([]rune(script))
	b := make([]byte, len(u)*2)
	for i, v := range u {
		binary.LittleEndian.PutUint16(b[i*2:], v)
	}
	return base64.StdEncoding.EncodeToString(b)
}

func literal(text string) string { return base64.StdEncoding.EncodeToString([]byte(text)) }

func (d desktopDriver) plan(name string, a desktopArgs) (actionPlan, error) {
	if !d.has(name) {
		return actionPlan{}, errors.New("desktop_capability_unavailable")
	}
	if name == "desktop_click" && (a.X == nil || a.Y == nil || *a.X < -100000 || *a.X > 100000 || *a.Y < -100000 || *a.Y > 100000) {
		return actionPlan{}, errors.New("invalid_coordinates")
	}
	if name == "desktop_type" && (a.Text == "" || len(a.Text) > 8192 || strings.ContainsRune(a.Text, 0)) {
		return actionPlan{}, errors.New("invalid_text")
	}
	if name == "desktop_scroll" && (a.DeltaY == 0 || a.DeltaY < -100 || a.DeltaY > 100) {
		return actionPlan{}, errors.New("invalid_scroll")
	}
	if name == "desktop_key" {
		if _, err := keyCode(a.Key, d.platform); err != nil {
			return actionPlan{}, err
		}
	}
	switch d.platform {
	case "windows":
		return windowsPlan(name, a)
	case "darwin":
		return macPlan(name, a)
	case "linux":
		switch name {
		case "desktop_screenshot":
			return actionPlan{"import", []string{"-window", "root", "png:-"}, false}, nil
		case "desktop_click":
			return actionPlan{"xdotool", []string{"mousemove", "--sync", strconv.Itoa(*a.X), strconv.Itoa(*a.Y), "click", "1"}, false}, nil
		case "desktop_type":
			return actionPlan{"xdotool", []string{"type", "--clearmodifiers", "--", a.Text}, false}, nil
		case "desktop_key":
			key, _ := keyCode(a.Key, "linux")
			return actionPlan{"xdotool", []string{"key", "--clearmodifiers", key}, false}, nil
		case "desktop_scroll":
			button, count := "5", a.DeltaY
			if count < 0 {
				button = "4"
				count = -count
			}
			return actionPlan{"xdotool", []string{"click", "--repeat", strconv.Itoa(count), "--delay", "20", button}, false}, nil
		}
	}
	return actionPlan{}, errors.New("desktop_capability_unavailable")
}

func (d desktopDriver) perform(ctx context.Context, name string, a desktopArgs) ([]byte, error) {
	p, err := d.plan(name, a)
	if err != nil {
		return nil, err
	}
	if d.platform == "darwin" && name == "desktop_screenshot" {
		file, err := os.CreateTemp("", "codevori-screen-*.png")
		if err != nil {
			return nil, errors.New("screenshot_storage_unavailable")
		}
		path := file.Name()
		file.Close()
		defer os.Remove(path)
		// 只捕获主屏，并缩放到 CoreGraphics 的逻辑坐标；Retina 像素不能直接用于鼠标坐标。
		bounds, err := d.execute(ctx, actionPlan{"osascript", []string{"-l", "JavaScript", "-e", "ObjC.import('CoreGraphics'); var b=$.CGDisplayBounds($.CGMainDisplayID()); JSON.stringify({width:b.size.width});"}, false})
		var screen struct {
			Width int `json:"width"`
		}
		if err != nil || json.Unmarshal(bounds, &screen) != nil || screen.Width < 1 || screen.Width > 20000 {
			return nil, errors.New("screen_geometry_unavailable")
		}
		p.args = []string{"-x", "-D", "1", "-t", "png", path}
		if _, err = d.execute(ctx, p); err != nil {
			return nil, err
		}
		if _, err = d.execute(ctx, actionPlan{"sips", []string{"--resampleWidth", strconv.Itoa(screen.Width), path}, false}); err != nil {
			return nil, err
		}
		info, err := os.Stat(path)
		if err != nil || info.Size() > 16<<20 {
			return nil, errors.New("screenshot_unavailable_or_too_large")
		}
		return os.ReadFile(path)
	}
	output, err := d.execute(ctx, p)
	if err != nil {
		return nil, err
	}
	if p.base64Image {
		return base64.StdEncoding.DecodeString(strings.TrimSpace(string(output)))
	}
	return output, nil
}
