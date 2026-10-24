package executor

import (
	"fmt"
	"strings"
)

func macPlan(name string, a desktopArgs) (actionPlan, error) {
	if name == "desktop_screenshot" {
		return actionPlan{"screencapture", nil, false}, nil
	}
	script := "ObjC.import('ApplicationServices'); if (!$.AXIsProcessTrusted()) throw new Error('accessibility permission required');"
	switch name {
	case "desktop_type":
		script += "ObjC.import('Foundation'); Application('System Events').keystroke(ObjC.unwrap($.NSString.alloc.initWithDataEncoding($.NSData.alloc.initWithBase64EncodedStringOptions('" + literal(a.Text) + "',0),4)));"
	case "desktop_click":
		script += fmt.Sprintf("var p={x:%d,y:%d}; $.CGEventPost(0,$.CGEventCreateMouseEvent(null,1,p,0)); $.CGEventPost(0,$.CGEventCreateMouseEvent(null,2,p,0));", *a.X, *a.Y)
	case "desktop_key":
		key, _ := keyCode(a.Key, "darwin")
		values := strings.Split(key, ",")
		script += fmt.Sprintf("var down=$.CGEventCreateKeyboardEvent(null,%s,true),up=$.CGEventCreateKeyboardEvent(null,%s,false); $.CGEventSetFlags(down,%s); $.CGEventSetFlags(up,%s); $.CGEventPost(0,down); $.CGEventPost(0,up);", values[0], values[0], values[1], values[1])
	case "desktop_scroll":
		script += fmt.Sprintf("$.CGEventPost(0,$.CGEventCreateScrollWheelEvent(null,1,1,%d));", -a.DeltaY)
	}
	return actionPlan{"osascript", []string{"-l", "JavaScript", "-e", script}, false}, nil
}
