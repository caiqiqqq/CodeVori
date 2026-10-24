package nodeapp

import (
	"errors"
	"net/url"
	"strings"
)

func parseAppLink(raw string) (invitation, error) {
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "codevori-node" || u.Host != "enroll" || u.User != nil || u.Path != "" || u.Fragment != "" {
		return invitation{}, errors.New("invalid_installation_invitation")
	}
	values, e := url.ParseQuery(u.RawQuery)
	if e != nil || len(values) != 2 || len(values["service"]) != 1 || len(values["invitation"]) != 1 {
		return invitation{}, errors.New("invalid_installation_invitation")
	}
	i := invitation{ServiceURL: values.Get("service"), Invitation: values.Get("invitation")}
	if strings.TrimRight(i.ServiceURL, "/") != strings.TrimRight(ServiceURL, "/") || !secretPattern.MatchString(i.Invitation) {
		return invitation{}, errors.New("invalid_installation_invitation")
	}
	return i, nil
}
