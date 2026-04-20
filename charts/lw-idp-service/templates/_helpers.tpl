{{/*
Full name: use Chart.Name when deployed as a subchart (release name differs from chart name),
so each service keeps its canonical name (gateway-svc, identity-svc, …) whether installed
individually or as part of the lw-idp umbrella.
*/}}
{{- define "lw-idp-service.fullname" -}}
{{- if eq .Release.Name .Chart.Name -}}
{{ .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else -}}
{{ .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end -}}
{{- end -}}

{{/*
Common labels
*/}}
{{- define "lw-idp-service.labels" -}}
app.kubernetes.io/name: {{ include "lw-idp-service.fullname" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: lw-idp
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end -}}

{{/*
Selector labels (stable across upgrades)
*/}}
{{- define "lw-idp-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "lw-idp-service.fullname" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
