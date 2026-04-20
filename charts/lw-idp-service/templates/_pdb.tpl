{{- define "lw-idp-service.pdb" -}}
{{- if .Values.podDisruptionBudget.enabled -}}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "lw-idp-service.fullname" . }}
  labels:
    {{- include "lw-idp-service.labels" . | nindent 4 }}
spec:
  minAvailable: {{ .Values.podDisruptionBudget.minAvailable | default 1 }}
  selector:
    matchLabels:
      {{- include "lw-idp-service.selectorLabels" . | nindent 6 }}
{{- end -}}
{{- end -}}
