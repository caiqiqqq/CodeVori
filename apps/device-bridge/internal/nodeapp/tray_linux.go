package nodeapp

import (
	"bytes"
	"context"
	"image/png"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/godbus/dbus/v5/introspect"
	"github.com/godbus/dbus/v5/prop"
)

const trayInterface = "org.kde.StatusNotifierItem"
const menuInterface = "com.canonical.dbusmenu"
const watcherInterface = "org.kde.StatusNotifierWatcher"

type linuxTray struct{ actions []trayAction }
type trayPixmap struct {
	Width, Height int32
	Data          []byte
}
type trayTooltip struct {
	Icon               string
	Pixmaps            []trayPixmap
	Title, Description string
}
type menuLayout struct {
	ID         int32
	Properties map[string]dbus.Variant
	Children   []dbus.Variant
}
type menuProperties struct {
	ID         int32
	Properties map[string]dbus.Variant
}
type menuEvent struct {
	ID        int32
	Event     string
	Data      dbus.Variant
	Timestamp uint32
}

func (t *linuxTray) Activate(int32, int32) *dbus.Error        { invokeTrayAction(t.actions[0]); return nil }
func (t *linuxTray) SecondaryActivate(x, y int32) *dbus.Error { return t.Activate(x, y) }
func (t *linuxTray) ContextMenu(x, y int32) *dbus.Error       { return t.Activate(x, y) }
func (t *linuxTray) Scroll(int32, string) *dbus.Error         { return nil }

func (t *linuxTray) properties(id int32, names []string) map[string]dbus.Variant {
	values := map[string]dbus.Variant{}
	if id == 0 {
		values["children-display"] = dbus.MakeVariant("submenu")
	}
	if id > 0 && id <= int32(len(t.actions)) {
		values["label"] = dbus.MakeVariant(t.actions[id-1].label)
		values["enabled"] = dbus.MakeVariant(true)
		values["visible"] = dbus.MakeVariant(true)
	}
	if len(names) == 0 {
		return values
	}
	filtered := map[string]dbus.Variant{}
	for _, name := range names {
		if value, ok := values[name]; ok {
			filtered[name] = value
		}
	}
	return filtered
}
func (t *linuxTray) GetLayout(parent, depth int32, names []string) (uint32, menuLayout, *dbus.Error) {
	if parent < 0 || parent > int32(len(t.actions)) {
		return 0, menuLayout{}, dbus.NewError("com.canonical.dbusmenu.Error.UnknownId", []any{parent})
	}
	root := menuLayout{parent, t.properties(parent, names), []dbus.Variant{}}
	if parent == 0 && depth != 0 {
		for i := range t.actions {
			id := int32(i + 1)
			root.Children = append(root.Children, dbus.MakeVariant(menuLayout{id, t.properties(id, names), []dbus.Variant{}}))
		}
	}
	return 1, root, nil
}
func (t *linuxTray) GetGroupProperties(ids []int32, names []string) ([]menuProperties, *dbus.Error) {
	result := []menuProperties{}
	if len(ids) == 0 {
		for i := range t.actions {
			ids = append(ids, int32(i+1))
		}
	}
	for _, id := range ids {
		result = append(result, menuProperties{id, t.properties(id, names)})
	}
	return result, nil
}
func (t *linuxTray) GetProperty(id int32, name string) (dbus.Variant, *dbus.Error) {
	if value, ok := t.properties(id, nil)[name]; ok {
		return value, nil
	}
	return dbus.Variant{}, dbus.NewError("com.canonical.dbusmenu.Error.UnknownProperty", []any{name})
}
func (t *linuxTray) Event(id int32, event string, _ dbus.Variant, _ uint32) *dbus.Error {
	if event == "clicked" && id > 0 && id <= int32(len(t.actions)) {
		invokeTrayAction(t.actions[id-1])
	}
	return nil
}
func (t *linuxTray) EventGroup(events []menuEvent) ([]int32, *dbus.Error) {
	failed := []int32{}
	for _, e := range events {
		if e.ID <= 0 || e.ID > int32(len(t.actions)) {
			failed = append(failed, e.ID)
			continue
		}
		_ = t.Event(e.ID, e.Event, e.Data, e.Timestamp)
	}
	return failed, nil
}
func (t *linuxTray) AboutToShow(int32) (bool, *dbus.Error) { return false, nil }
func (t *linuxTray) AboutToShowGroup([]int32) ([]int32, []int32, *dbus.Error) {
	return []int32{}, []int32{}, nil
}

func nodeTrayPixmap() (trayPixmap, error) {
	img, err := png.Decode(bytes.NewReader(nodeTrayPNG))
	if err != nil {
		return trayPixmap{}, err
	}
	bounds := img.Bounds()
	pixels := make([]byte, 0, bounds.Dx()*bounds.Dy()*4)
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			pixels = append(pixels, byte(a>>8), byte(r>>8), byte(g>>8), byte(b>>8)) // SNI uses network-order ARGB32.
		}
	}
	return trayPixmap{int32(bounds.Dx()), int32(bounds.Dy()), pixels}, nil
}

func exportLinuxTray(conn *dbus.Conn, tray *linuxTray) error {
	pixmap, err := nodeTrayPixmap()
	if err != nil {
		return err
	}
	path, menuPath := dbus.ObjectPath("/StatusNotifierItem"), dbus.ObjectPath("/Menu")
	if err = conn.ExportMethodTable(map[string]any{"Activate": tray.Activate, "SecondaryActivate": tray.SecondaryActivate, "ContextMenu": tray.ContextMenu, "Scroll": tray.Scroll}, path, trayInterface); err != nil {
		return err
	}
	if err = conn.ExportMethodTable(map[string]any{"GetLayout": tray.GetLayout, "GetGroupProperties": tray.GetGroupProperties, "GetProperty": tray.GetProperty, "Event": tray.Event, "EventGroup": tray.EventGroup, "AboutToShow": tray.AboutToShow, "AboutToShowGroup": tray.AboutToShowGroup}, menuPath, menuInterface); err != nil {
		return err
	}
	values := map[string]any{
		"Category": "ApplicationStatus", "Id": "codevori-node", "Title": "CodeVori Node", "Status": "Active", "WindowId": uint32(0),
		"IconName": "", "IconPixmap": []trayPixmap{pixmap}, "OverlayIconName": "", "OverlayIconPixmap": []trayPixmap{},
		"AttentionIconName": "", "AttentionIconPixmap": []trayPixmap{}, "AttentionMovieName": "",
		"ToolTip": trayTooltip{"", []trayPixmap{}, "CodeVori Node", "打开状态查看连接"}, "ItemIsMenu": false, "Menu": menuPath,
	}
	properties := prop.Map{trayInterface: {}}
	for name, value := range values {
		properties[trayInterface][name] = &prop.Prop{Value: value}
	}
	itemProps, err := prop.Export(conn, path, properties)
	if err != nil {
		return err
	}
	if err = exportTrayIntrospection(conn, path, trayInterface, tray, itemProps, []string{"Activate", "SecondaryActivate", "ContextMenu", "Scroll"}); err != nil {
		return err
	}
	menuProps, err := prop.Export(conn, menuPath, prop.Map{menuInterface: {
		"Version": {Value: uint32(3)}, "TextDirection": {Value: "ltr"}, "Status": {Value: "normal"}, "IconThemePath": {Value: []string{}},
	}})
	if err != nil {
		return err
	}
	return exportTrayIntrospection(conn, menuPath, menuInterface, tray, menuProps, []string{"GetLayout", "GetGroupProperties", "GetProperty", "Event", "EventGroup", "AboutToShow", "AboutToShowGroup"})
}

func exportTrayIntrospection(conn *dbus.Conn, path dbus.ObjectPath, name string, tray *linuxTray, properties *prop.Properties, names []string) error {
	methods := []introspect.Method{}
	for _, method := range introspect.Methods(tray) {
		for _, allowed := range names {
			if method.Name == allowed {
				methods = append(methods, method)
			}
		}
	}
	return conn.Export(introspect.NewIntrospectable(&introspect.Node{Interfaces: []introspect.Interface{{Name: name, Methods: methods, Properties: properties.Introspection(name)}}}), path, "org.freedesktop.DBus.Introspectable")
}

func startTray(ctx context.Context, dir string, installed bool, cancel context.CancelFunc) func() {
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := dbus.ConnectSessionBus()
		if err != nil {
			return
		} // Headless sessions still execute through the existing runtime.
		defer conn.Close()
		if exportLinuxTray(conn, &linuxTray{newTrayActions(dir, installed, cancel)}) != nil {
			return
		}
		signals := make(chan *dbus.Signal, 8)
		conn.Signal(signals)
		defer conn.RemoveSignal(signals)
		_ = conn.AddMatchSignal(dbus.WithMatchInterface("org.freedesktop.DBus"), dbus.WithMatchMember("NameOwnerChanged"), dbus.WithMatchArg(0, watcherInterface))
		_ = conn.AddMatchSignal(dbus.WithMatchInterface(watcherInterface), dbus.WithMatchMember("StatusNotifierHostRegistered"))
		register := func() {
			request, stop := context.WithTimeout(ctx, 2*time.Second)
			defer stop()
			_ = conn.Object(watcherInterface, "/StatusNotifierWatcher").CallWithContext(request, watcherInterface+".RegisterStatusNotifierItem", 0, "/StatusNotifierItem").Err
		}
		register()
		for {
			select {
			case <-ctx.Done():
				return
			case <-conn.Context().Done():
				return
			case <-signals:
				register() // Re-register if the desktop tray host restarts.
			}
		}
	}()
	return func() { cancel(); <-done }
}
