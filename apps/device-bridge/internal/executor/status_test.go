package executor

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestNodeStatusMeasuresLocalResourcesAndListsCurrentProcess(t *testing.T) {
	s, _ := New(2)
	content, err := s.call(context.Background(), "node_status", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(content[0])
	var text struct {
		Text string `json:"text"`
	}
	_ = json.Unmarshal(data, &text)
	var status systemStatus
	if err := json.Unmarshal([]byte(text.Text), &status); err != nil {
		t.Fatal(err)
	}
	if status.CPUCount < 1 || status.SampledAt == "" || status.Memory == nil || status.Memory.TotalBytes == 0 || (status.ProcessCount == nil || *status.ProcessCount < 1) {
		t.Fatalf("invalid OS measurement: %+v", status)
	}
	if status.CPUPercent != nil && (*status.CPUPercent < 0 || *status.CPUPercent > 100) {
		t.Fatal("invalid CPU percent")
	}
	if len(status.Processes) > 100 {
		t.Fatal("unbounded process result")
	}
	found := false
	for _, p := range status.Processes {
		if p.PID == int32(os.Getpid()) {
			found = true
		}
	}
	if !found && !status.ProcessesPartial && status.InspectedProcessCount <= 100 {
		t.Fatal("complete sample omitted its own process")
	}
	for i := 1; i < len(status.Processes); i++ {
		if processMemory(status.Processes[i-1]) < processMemory(status.Processes[i]) {
			t.Fatal("processes not ordered by resident memory")
		}
	}
	if _, err := s.call(context.Background(), "node_status", json.RawMessage(`{"command":"anything"}`)); err == nil {
		t.Fatal("arbitrary status arguments accepted")
	}
}
func TestNodeStatusHonorsCancellationAndCapacity(t *testing.T) {
	s, _ := New(1)
	s.statusBusy <- struct{}{}
	if _, err := s.call(context.Background(), "node_status", json.RawMessage(`{}`)); err == nil {
		t.Fatal("overlapping samples accepted")
	}
	<-s.statusBusy
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.call(ctx, "node_status", json.RawMessage(`{}`)); err == nil {
		t.Fatal("cancelled sample returned current data")
	}
	if len(s.statusBusy) != 0 {
		t.Fatal("sampler slot leaked")
	}
}
