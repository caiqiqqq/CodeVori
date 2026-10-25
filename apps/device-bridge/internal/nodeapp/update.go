package nodeapp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// These values belong to the independent client release, not the desktop application.
var Version = "0.0.10"
var UpdateManifestURL = "https://aimodetest.cn/codevori-node/clients/latest.json"
var errNoUpdate = errors.New("node_already_latest")
var releaseVersion = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)
var releaseHash = regexp.MustCompile(`^[a-f0-9]{64}$`)

type updateFile struct {
	Platform string `json:"platform"`
	Name     string `json:"name"`
	URL      string `json:"url"`
	Bytes    int64  `json:"bytes"`
	SHA256   string `json:"sha256"`
}
type updateManifest struct {
	Version    string       `json:"version"`
	ServiceURL string       `json:"serviceUrl"`
	Files      []updateFile `json:"files"`
}

func newerVersion(next, current string) bool {
	if !releaseVersion.MatchString(next) || !releaseVersion.MatchString(current) {
		return false
	}
	a, b := strings.Split(next, "."), strings.Split(current, ".")
	for i := range a {
		x, e1 := strconv.ParseUint(a[i], 10, 32)
		y, e2 := strconv.ParseUint(b[i], 10, 32)
		if e1 != nil || e2 != nil {
			return false
		}
		if x != y {
			return x > y
		}
	}
	return false
}

func updateHTTP(ctx context.Context, address string) (*http.Response, error) {
	r, err := http.NewRequestWithContext(ctx, "GET", address, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(r)
	if err != nil {
		return nil, errors.New("node_update_unavailable")
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, errors.New("node_update_unavailable")
	}
	return response, nil
}

func checkUpdate(ctx context.Context, address, service, platform, current string) (updateManifest, updateFile, error) {
	var manifest updateManifest
	var file updateFile
	if validateUpdateURL(address) != nil {
		return manifest, file, errors.New("invalid_update_source")
	}
	response, err := updateHTTP(ctx, address)
	if err != nil {
		return manifest, file, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 32769))
	if err != nil || len(data) > 32768 || json.Unmarshal(data, &manifest) != nil || manifest.ServiceURL != service || !releaseVersion.MatchString(manifest.Version) {
		return manifest, file, errors.New("invalid_update_manifest")
	}
	base, _ := url.Parse(address)
	name := "CodeVoriNode-" + platform
	if strings.HasPrefix(platform, "win32-") {
		name += ".exe"
	}
	if !validUpdatePlatform(platform) {
		return manifest, file, errors.New("invalid_update_platform")
	}
	expected := *base
	expected.Path = strings.TrimSuffix(base.Path, "latest.json") + manifest.Version + "/" + name
	expected.RawPath = ""
	found := 0
	for _, entry := range manifest.Files {
		if entry.Platform != platform {
			continue
		}
		found++
		if entry.Name != name || entry.URL != expected.String() || entry.Bytes <= 0 || entry.Bytes > 128<<20 || !releaseHash.MatchString(entry.SHA256) {
			return manifest, file, errors.New("invalid_update_manifest")
		}
		file = entry
	}
	if found != 1 {
		return manifest, file, errors.New("invalid_update_manifest")
	}
	if !newerVersion(manifest.Version, current) {
		return manifest, file, errNoUpdate
	}
	return manifest, file, nil
}

func downloadUpdate(ctx context.Context, directory string, file updateFile) (path string, err error) {
	response, err := updateHTTP(ctx, file.URL)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	f, err := os.CreateTemp(directory, "node-update-*.exe")
	if err != nil {
		return "", err
	}
	path = f.Name()
	defer func() {
		_ = f.Close()
		if err != nil {
			_ = os.Remove(path)
		}
	}()
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, hash), io.LimitReader(response.Body, file.Bytes+1))
	if err != nil {
		return path, err
	}
	if n != file.Bytes || hex.EncodeToString(hash.Sum(nil)) != file.SHA256 {
		return path, errors.New("node_update_integrity_failed")
	}
	if err = f.Chmod(0700); err != nil {
		return path, err
	}
	if err = f.Close(); err != nil {
		return path, err
	}
	return path, nil
}

func CheckForUpdate(ctx context.Context) error {
	dir, _, err := paths()
	if err != nil {
		return err
	}
	_, err = readConfig(dir)
	if err != nil {
		return errors.New("invalid_update_source")
	}
	platform := runtime.GOOS + "-" + runtime.GOARCH
	platform = strings.Replace(platform, "windows-", "win32-", 1)
	platform = strings.Replace(platform, "-amd64", "-x64", 1)
	manifest, file, err := checkUpdate(ctx, UpdateManifestURL, ServiceURL, platform, Version)
	if errors.Is(err, errNoUpdate) {
		notify("CodeVori Node", "当前已是最新版本："+Version)
		return nil
	}
	if err != nil {
		return err
	}
	if !confirm("更新 CodeVori Node", fmt.Sprintf("当前版本 %s，可更新至 %s。更新会短暂断开连接，并保留 Tailscale 身份和控制授权。是否下载并更新？", Version, manifest.Version)) {
		return nil
	}
	directory := filepath.Join(dir, "updates")
	if err = os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	filePath, err := downloadUpdate(ctx, directory, file)
	if err != nil {
		return err
	}
	if err = startDetached(filePath, "apply-update", file.SHA256); err != nil {
		_ = os.Remove(filePath)
	}
	return err
}

// An update runs from its private staging file so Windows can release the installed executable.
func ApplyUpdate(ctx context.Context, expectedHash string) error {
	dir, binary, err := paths()
	if err != nil {
		return err
	}
	_, err = readConfig(dir)
	if err != nil {
		return errors.New("invalid_update_source")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if filepath.Dir(executable) != filepath.Join(dir, "updates") || !releaseHash.MatchString(expectedHash) {
		return errors.New("invalid_update_source")
	}
	data, err := os.ReadFile(executable)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != expectedHash {
		return errors.New("node_update_integrity_failed")
	}
	release, err := lock(filepath.Join(dir, "installation.lock"))
	if err != nil {
		return errors.New("installation_already_running")
	}
	defer release()
	instance, err := stopAndLockNode(ctx, dir)
	if err != nil {
		return err
	}
	defer func() {
		if instance != nil {
			instance()
		}
	}()
	err = replaceNodeExecutable(executable, binary, func() error {
		if err := refreshInstalledNodeAppearance(binary); err != nil {
			return err
		}
		if instance != nil {
			instance()
			instance = nil
		}
		return startDetached(binary, "agent")
	})
	if err != nil && instance != nil {
		instance()
		instance = nil
		_ = startDetached(binary, "agent")
	}
	// Unix can unlink the staging executable immediately; Windows may retain this private file.
	_ = os.Remove(executable)
	if err == nil {
		notify("CodeVori Node", "已更新到 "+Version+"，正在重新连接。")
	}
	return err
}

func stopAndLockNode(ctx context.Context, dir string) (func(), error) {
	_ = stopLocal(dir)
	deadline := time.NewTimer(10 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	for {
		if release, err := lock(filepath.Join(dir, "instance.lock")); err == nil {
			return release, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-deadline.C:
			return nil, errors.New("previous_node_still_stopping")
		case <-tick.C:
		}
	}
}

func replaceNodeExecutable(source, binary string, start func() error) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	f, err := os.OpenFile(binary+".new", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0755)
	if err != nil {
		return err
	}
	defer os.Remove(binary + ".new")
	_, copyErr := io.Copy(f, input)
	closeErr := f.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	backup := binary + ".previous"
	if err = os.Remove(backup); err != nil && !os.IsNotExist(err) {
		return err
	}
	// 实例锁只代表 agent 已释放；Windows 还会短暂持有旧更新进程的映像句柄。
	// 仅重试该系统文件占用，不重放任何 MCP 请求或改写网络身份。
	deadline := time.Now().Add(10 * time.Second)
	for {
		err = os.Rename(binary, backup)
		if err == nil || runtime.GOOS != "windows" || time.Now().After(deadline) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err != nil {
		_ = start()
		return err
	}
	rollback := func() { _ = os.Remove(binary); _ = os.Rename(backup, binary); _ = start() }
	if err = os.Rename(binary+".new", binary); err != nil {
		rollback()
		return err
	}
	if err = start(); err != nil {
		rollback()
		return err
	}
	_ = os.Remove(backup)
	return nil
}

func validateUpdateURL(address string) error {
	u, err := url.Parse(address)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"))) {
		return errors.New("invalid_update_source")
	}
	return nil
}
func validUpdatePlatform(platform string) bool {
	switch platform {
	case "win32-x64", "win32-arm64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64":
		return true
	}
	return false
}
