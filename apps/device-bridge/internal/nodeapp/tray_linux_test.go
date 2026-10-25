package nodeapp

import (
	"bufio"
	"context"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/godbus/dbus/v5"
)

type testTrayWatcher struct{ registrations chan string }

func (w *testTrayWatcher) RegisterStatusNotifierItem(path string, sender dbus.Sender) *dbus.Error {
	if path == "/StatusNotifierItem" {
		w.registrations <- string(sender)
	}
	return nil
}

func TestLinuxTraySessionBusLifecycle(t *testing.T) {
	if _, err := exec.LookPath("dbus-daemon"); err != nil {
		t.Skip("requires isolated dbus-daemon")
	}
	daemon := exec.Command("dbus-daemon", "--session", "--nofork", "--print-address=1")
	stdout, err := daemon.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = daemon.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = daemon.Process.Kill(); _ = daemon.Wait() }()
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() {
		t.Fatal("missing isolated session bus")
	}
	t.Setenv("DBUS_SESSION_BUS_ADDRESS", scanner.Text())
	watcher, err := dbus.ConnectSessionBus()
	if err != nil {
		t.Fatal(err)
	}
	defer watcher.Close()
	w := &testTrayWatcher{make(chan string, 4)}
	if err = watcher.Export(w, "/StatusNotifierWatcher", watcherInterface); err != nil {
		t.Fatal(err)
	}
	if _, err = watcher.RequestName(watcherInterface, dbus.NameFlagDoNotQueue); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stop := startTray(ctx, t.TempDir(), false, cancel)
	defer stop()
	var peer string
	select {
	case peer = <-w.registrations:
	case <-time.After(3 * time.Second):
		t.Fatal("tray not registered")
	}
	item := watcher.Object(peer, "/StatusNotifierItem")
	pixmap, err := item.GetProperty(trayInterface + ".IconPixmap")
	if err != nil || pixmap.Signature().String() != "a(iiay)" {
		t.Fatal("icon not exported on session bus", err)
	}
	var revision uint32
	var layout menuLayout
	menu := watcher.Object(peer, "/Menu")
	if err = menu.Call(menuInterface+".GetLayout", 0, int32(0), int32(-1), []string{}).Store(&revision, &layout); err != nil || len(layout.Children) != 2 {
		t.Fatal("native menu unavailable", err)
	}
	// A replacement tray host must rediscover the same process presentation.
	_, _ = watcher.ReleaseName(watcherInterface)
	_, _ = watcher.RequestName(watcherInterface, dbus.NameFlagDoNotQueue)
	select {
	case next := <-w.registrations:
		if next != peer {
			t.Fatal("tray created another connection owner")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("tray did not recover host restart")
	}
	if err = menu.Call(menuInterface+".Event", 0, int32(2), "clicked", dbus.MakeVariant(int32(0)), uint32(0)).Err; err != nil {
		t.Fatal(err)
	}
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("wire menu event did not stop runtime")
	}
	stop()
	var hasOwner bool
	if err = watcher.BusObject().Call("org.freedesktop.DBus.NameHasOwner", 0, peer).Store(&hasOwner); err != nil || hasOwner {
		t.Fatal("stopped tray leaked bus presentation", err)
	}
}

func TestLinuxTrayProtocolAndActionBoundary(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tray := &linuxTray{newTrayActions(t.TempDir(), false, cancel)}
	_, layout, err := tray.GetLayout(0, -1, nil)
	if err != nil || len(layout.Children) != 2 {
		t.Fatal("local menu must exclude uninstall", err)
	}
	if signature := dbus.SignatureOf(layout).String(); signature != "(ia{sv}av)" {
		t.Fatal("invalid dbusmenu layout", signature)
	}
	pixmap, e := nodeTrayPixmap()
	if e != nil || len(pixmap.Data) != int(pixmap.Width*pixmap.Height*4) {
		t.Fatal("invalid ARGB tray image", e)
	}
	if strings.Contains(dbus.MakeVariant(layout).String(), "connection.json") {
		t.Fatal("private configuration exposed in menu")
	}
	_ = tray.Event(3, "clicked", dbus.MakeVariant(int32(0)), 0)
	if ctx.Err() != nil {
		t.Fatal("invalid action executed")
	}
	_ = tray.Event(2, "clicked", dbus.MakeVariant(int32(0)), 0)
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("stop did not cancel runtime")
	}
}
