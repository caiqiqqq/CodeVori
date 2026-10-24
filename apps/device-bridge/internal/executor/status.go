package executor

import (
	"context"
	"errors"
	"math"
	"runtime"
	"slices"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/process"
)

type memoryStatus struct {
	TotalBytes     uint64 `json:"totalBytes"`
	UsedBytes      uint64 `json:"usedBytes"`
	AvailableBytes uint64 `json:"availableBytes"`
}
type processStatus struct {
	PID        int32    `json:"pid"`
	Name       string   `json:"name"`
	RSSBytes   *uint64  `json:"rssBytes"`
	CPUSeconds *float64 `json:"cpuSeconds"`
}
type systemStatus struct {
	SampledAt             string          `json:"sampledAt"`
	Platform              string          `json:"platform"`
	Architecture          string          `json:"architecture"`
	CPUCount              int             `json:"cpuCount"`
	CPUModel              string          `json:"cpuModel"`
	CPUPercent            *float64        `json:"cpuPercent"`
	Memory                *memoryStatus   `json:"memory"`
	ProcessCount          *int            `json:"processCount"`
	InspectedProcessCount int             `json:"inspectedProcessCount"`
	ProcessesPartial      bool            `json:"processesPartial"`
	Processes             []processStatus `json:"processes"`
}

func processMemory(p processStatus) uint64 {
	if p.RSSBytes == nil {
		return 0
	}
	return *p.RSSBytes
}
func validMetric(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 }
func (s *Server) sampleStatus(ctx context.Context) (systemStatus, error) {
	result := systemStatus{Platform: runtime.GOOS, Architecture: runtime.GOARCH, CPUCount: runtime.NumCPU(), Processes: []processStatus{}}
	select {
	case s.statusBusy <- struct{}{}:
		defer func() { <-s.statusBusy }()
	default:
		return result, errors.New("node_status_busy")
	}
	if ctx.Err() != nil {
		return result, errors.New("node_status_unavailable")
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	if v, err := cpu.PercentWithContext(ctx, 300*time.Millisecond, false); err == nil && len(v) > 0 && validMetric(v[0]) {
		value := min(v[0], 100)
		result.CPUPercent = &value
	}
	if v, err := cpu.InfoWithContext(ctx); err == nil && len(v) > 0 {
		runes := []rune(strings.ToValidUTF8(v[0].ModelName, "�"))
		result.CPUModel = string(runes[:min(len(runes), 256)])
	}
	if v, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		result.Memory = &memoryStatus{v.Total, v.Used, v.Available}
	}
	ids, err := process.PidsWithContext(ctx)
	if err != nil {
		result.ProcessesPartial = true
	} else {
		count := len(ids)
		result.ProcessCount = &count
		sampleCtx, stop := context.WithTimeout(ctx, 2*time.Second)
		defer stop()
		// 系统进程可能随时退出或拒绝查询；不把缺失值当作 0，也不无限扫描大量进程。
		for i, id := range ids {
			if i >= 2048 || sampleCtx.Err() != nil {
				result.ProcessesPartial = true
				break
			}
			if id <= 0 {
				continue
			}
			p, err := process.NewProcessWithContext(sampleCtx, id)
			if err != nil {
				result.ProcessesPartial = true
				continue
			}
			name, err := p.NameWithContext(sampleCtx)
			if err != nil {
				result.ProcessesPartial = true
				continue
			}
			runes := []rune(strings.ToValidUTF8(name, "�"))
			if len(runes) > 512 {
				runes = runes[:512]
			}
			item := processStatus{PID: id, Name: string(runes)}
			if v, err := p.MemoryInfoWithContext(sampleCtx); err == nil {
				item.RSSBytes = &v.RSS
			} else {
				result.ProcessesPartial = true
			}
			if v, err := p.TimesWithContext(sampleCtx); err == nil && validMetric(v.User+v.System) {
				total := v.User + v.System
				item.CPUSeconds = &total
			} else {
				result.ProcessesPartial = true
			}
			result.Processes = append(result.Processes, item)
		}
	}
	if ctx.Err() != nil {
		return result, errors.New("node_status_unavailable")
	}
	result.InspectedProcessCount = len(result.Processes)
	slices.SortFunc(result.Processes, func(a, b processStatus) int {
		av, bv := processMemory(a), processMemory(b)
		if av > bv {
			return -1
		}
		if av < bv {
			return 1
		}
		return int(a.PID - b.PID)
	})
	if len(result.Processes) > 100 {
		result.Processes = result.Processes[:100]
	}
	result.SampledAt = time.Now().UTC().Format(time.RFC3339Nano)
	return result, nil
}
