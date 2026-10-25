//go:build !darwin

package main

import "zcode.local/device-bridge/internal/nodeapp"

func runMain(args []string) error { return nodeapp.Main(args) }
