// node-resources embeds the existing brand icon in a packaged Windows client before hashing.
package main

import (
	"errors"
	"fmt"
	"os"

	"github.com/tc-hib/winres"
)

func embedIcon(executable, iconPath string) error {
	iconFile, err := os.Open(iconPath)
	if err != nil {
		return err
	}
	defer iconFile.Close()
	icon, err := winres.LoadICO(iconFile)
	if err != nil {
		return err
	}
	source, err := os.Open(executable)
	if err != nil {
		return err
	}
	defer source.Close()
	resources, err := winres.LoadFromEXE(source)
	if err != nil && !errors.Is(err, winres.ErrNoResources) {
		return err
	}
	if err = resources.SetIcon(winres.ID(1), icon); err != nil {
		return err
	}
	output, err := os.Create(executable + ".icon")
	if err != nil {
		return err
	}
	defer os.Remove(output.Name())
	err = resources.WriteToEXE(output, source)
	closeErr := output.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	// 校验真实 PE 资源后才替换原文件；清单不能为无图标或损坏的文件计算哈希。
	check, err := os.Open(output.Name())
	if err != nil {
		return err
	}
	loaded, err := winres.LoadFromEXE(check)
	_ = check.Close()
	if err != nil {
		return err
	}
	if _, err = loaded.GetIcon(winres.ID(1)); err != nil {
		return err
	}
	_ = source.Close() // Windows cannot replace an executable while this input handle is open.
	return os.Rename(output.Name(), executable)
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: node-resources EXECUTABLE ICON")
		os.Exit(2)
	}
	if err := embedIcon(os.Args[1], os.Args[2]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
