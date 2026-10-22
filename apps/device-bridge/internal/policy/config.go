// Package policy contains pure validation for the bridge's fixed endpoints.
package policy

import (
	"errors"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
)

func validPort(value string, allowZero bool) bool {
	n, err := strconv.Atoi(value)
	return err == nil && n >= 0 && n <= 65535 && (allowZero || n > 0)
}

func Target(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, errors.New("target must be an HTTP loopback endpoint without credentials, query or fragment")
	}
	ip, ipErr := netip.ParseAddr(u.Hostname())
	if u.Scheme != "http" || ipErr != nil || !ip.IsLoopback() || u.User != nil || u.Opaque != "" ||
		u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Path == "" ||
		(u.Port() != "" && !validPort(u.Port(), false)) {
		return nil, errors.New("target must be an HTTP loopback endpoint without credentials, query or fragment")
	}
	return u, nil
}

func LocalListener(addr string) error {
	host, port, err := net.SplitHostPort(addr)
	ip, ipErr := netip.ParseAddr(host)
	if err != nil || ipErr != nil || !ip.Is4() || !ip.IsLoopback() || !validPort(port, true) {
		return errors.New("listen must be a numeric IPv4 loopback address and port")
	}
	return nil
}

func Peer(addr string) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil || host == "" || !validPort(port, false) || strings.ContainsAny(host, "/@?#\\ \t\r\n") {
		return errors.New("peer must be host:port without a URL path or credentials")
	}
	return nil
}
