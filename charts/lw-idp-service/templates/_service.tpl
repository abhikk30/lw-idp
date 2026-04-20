{{- define "lw-idp-service.service" -}}
apiVersion: v1
kind: Service
metadata:
  name: {{ include "lw-idp-service.fullname" . }}
  labels:
    {{- include "lw-idp-service.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type | default "ClusterIP" }}
  ports:
    - port: {{ .Values.service.port | default 80 }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "lw-idp-service.selectorLabels" . | nindent 4 }}
{{- end -}}
