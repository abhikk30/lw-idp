{{- define "lw-idp-service.serviceAccount" -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "lw-idp-service.fullname" . }}
  labels:
    {{- include "lw-idp-service.labels" . | nindent 4 }}
{{- end -}}
