package executor

import (
	"errors"
	"fmt"
)

const windowsNative = `
$ErrorActionPreference='Stop';
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NodeInput {
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [StructLayout(LayoutKind.Sequential)] public struct Mouse {public int x,y; public uint data,flags,time; public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] public struct Keyboard {public ushort key,scan; public uint flags,time; public UIntPtr extra;}
 [StructLayout(LayoutKind.Explicit)] public struct Union {[FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard keyboard;}
 [StructLayout(LayoutKind.Sequential)] public struct Input {public uint type; public Union value;}
 [DllImport("user32.dll")] public static extern uint SendInput(uint count,Input[] input,int size);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,int data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 public static void Text(string text) {
  foreach(char c in text) {
   var input=new Input[2];
   input[0].type=1; input[0].value.keyboard.scan=c; input[0].value.keyboard.flags=4;
   input[1].type=1; input[1].value.keyboard.scan=c; input[1].value.keyboard.flags=6;
   if(SendInput(2,input,Marshal.SizeOf(typeof(Input)))!=2) throw new Exception("input refused");
  }
 }
}
'@;
[NodeInput]::SetProcessDPIAware() | Out-Null;
`

func windowsPlan(name string, a desktopArgs) (actionPlan, error) {
	script := windowsNative
	image := false
	switch name {
	case "desktop_screenshot":
		script = `$ErrorActionPreference='Stop';
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class NodeDpi {[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();}';
[NodeDpi]::SetProcessDPIAware() | Out-Null;
Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing;
$bounds=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
$bitmap=New-Object System.Drawing.Bitmap($bounds.Width,$bounds.Height);
$graphics=[System.Drawing.Graphics]::FromImage($bitmap);$stream=New-Object System.IO.MemoryStream;
try {$graphics.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bitmap.Size);$bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png);[Console]::Out.Write([Convert]::ToBase64String($stream.ToArray()))}
finally {$graphics.Dispose();$bitmap.Dispose();$stream.Dispose()}`
		image = true
	case "desktop_click":
		script += fmt.Sprintf("if(-not [NodeInput]::SetCursorPos(%d,%d)){throw 'cursor unavailable'};[NodeInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero);[NodeInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)", *a.X, *a.Y)
	case "desktop_type":
		script += "[NodeInput]::Text([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + literal(a.Text) + "')))"
	case "desktop_key":
		key, _ := keyCode(a.Key, "windows")
		script += key
	case "desktop_scroll":
		script += fmt.Sprintf("[NodeInput]::mouse_event(2048,0,0,%d,[UIntPtr]::Zero)", -a.DeltaY*120)
	}
	encoded := encodePowerShell(script)
	if len(encoded) > 30000 {
		return actionPlan{}, errors.New("native_input_too_large")
	}
	return actionPlan{"powershell.exe", []string{"-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded}, image}, nil
}
