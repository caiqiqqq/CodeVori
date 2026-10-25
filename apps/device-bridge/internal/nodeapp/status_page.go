package nodeapp

import (
	_ "embed"
	"html/template"
	"io"
)

//go:embed status_page.html
var statusPageHTML string

var statusPage = template.Must(template.New("node-status").Parse(statusPageHTML))

type statusPageView struct {
	Version, Token, Message, Label, Tone string
	Network                              template.HTML
	CanUninstall                         bool
}

func renderStatusPage(w io.Writer, view statusPageView) error {
	return statusPage.Execute(w, view)
}
