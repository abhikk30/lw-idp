{{- define "lw-idp-service.serviceMonitor" -}}
{{- if .Values.monitoring.enabled }}
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ include "lw-idp-service.fullname" . }}
  labels:
    {{- include "lw-idp-service.labels" . | nindent 4 }}
    release: kube-prometheus-stack
spec:
  selector:
    matchLabels:
      {{- include "lw-idp-service.selectorLabels" . | nindent 6 }}
  endpoints:
    - port: http
      path: {{ .Values.monitoring.path | default "/metrics" }}
      interval: {{ .Values.monitoring.interval | default "30s" }}
      scrapeTimeout: {{ .Values.monitoring.scrapeTimeout | default "10s" }}
{{- end }}
{{- end -}}
