package main

import (
	"fmt"
	"os"
	"zcode.local/device-bridge/internal/nodeapp"
)

func main() {
	err := runMain(os.Args[1:])
	if err != nil && len(os.Args) > 1 && os.Args[1] == "agent" {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	nodeapp.Report(err)
}
