//go:build !windows

package executor

import (
	"errors"
	"os"
	"os/exec"
	"syscall"
	"time"
)

func prepareProcess(cmd *exec.Cmd) func() {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.WaitDelay = time.Second
	stop := func() error {
		if cmd.Process == nil {
			return os.ErrProcessDone
		}
		err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		if errors.Is(err, syscall.ESRCH) {
			return os.ErrProcessDone
		}
		return err
	}
	cmd.Cancel = stop
	// 超时和 shell 正常退出都清理同组后代，避免后台子进程越过已释放的执行槽位。
	return func() { _ = stop() }
}
