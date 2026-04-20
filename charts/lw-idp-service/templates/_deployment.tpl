{{- define "lw-idp-service.deployment" -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "lw-idp-service.fullname" . }}
  labels:
    {{- include "lw-idp-service.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount | default 2 }}
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 0
  selector:
    matchLabels:
      {{- include "lw-idp-service.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "lw-idp-service.selectorLabels" . | nindent 8 }}
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/path: /metrics
        prometheus.io/port: "{{ .Values.service.targetPort | default 4000 }}"
    spec:
      serviceAccountName: {{ include "lw-idp-service.fullname" . }}
      topologySpreadConstraints:
        - maxSkew: {{ .Values.topologySpreadConstraints.maxSkew | default 1 }}
          topologyKey: kubernetes.io/hostname
          whenUnsatisfiable: {{ .Values.topologySpreadConstraints.whenUnsatisfiable | default "ScheduleAnyway" }}
          labelSelector:
            matchLabels:
              {{- include "lw-idp-service.selectorLabels" . | nindent 14 }}
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                topologyKey: kubernetes.io/hostname
                labelSelector:
                  matchLabels:
                    {{- include "lw-idp-service.selectorLabels" . | nindent 20 }}
      containers:
        - name: app
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default "latest" }}"
          imagePullPolicy: {{ .Values.image.pullPolicy | default "IfNotPresent" }}
          ports:
            - name: http
              containerPort: {{ .Values.service.targetPort | default 4000 }}
              protocol: TCP
          env:
            - name: PORT
              value: "{{ .Values.service.targetPort | default 4000 }}"
            - name: LOG_LEVEL
              value: {{ .Values.logLevel | default "info" }}
            - name: NODE_ENV
              value: {{ .Values.nodeEnv | default "production" }}
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: "http://kube-prometheus-stack-otel-collector.observability.svc.cluster.local:4318/v1/traces"
            {{- with .Values.extraEnv }}
            {{- toYaml . | nindent 12 }}
            {{- end }}
          readinessProbe:
            httpGet:
              path: {{ .Values.probes.readiness.path | default "/readyz" }}
              port: http
            periodSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: {{ .Values.probes.liveness.path | default "/healthz" }}
              port: http
            initialDelaySeconds: 15
            periodSeconds: 20
          startupProbe:
            httpGet:
              path: {{ .Values.probes.readiness.path | default "/readyz" }}
              port: http
            failureThreshold: 30
            periodSeconds: 2
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          lifecycle:
            preStop:
              exec:
                command: ["sleep", "5"]
{{- end -}}
