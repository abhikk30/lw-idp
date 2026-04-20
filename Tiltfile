# lw-idp local dev — live-reload for all six apps on the kind-dev cluster.

load('ext://helm_resource', 'helm_resource')

allow_k8s_contexts(['kind-lw-idp-dev'])

REGISTRY = 'localhost:5001/lw-idp'

BACKEND_SERVICES = [
    ('gateway-svc', 4000),
    ('identity-svc', 4001),
    ('catalog-svc', 4002),
    ('cluster-svc', 4003),
    ('notification-svc', 4004),
]

# Backend services: TypeScript + service-kit, same Dockerfile shape
for name, port in BACKEND_SERVICES:
    image_ref = '{}/{}'.format(REGISTRY, name)
    docker_build(
        image_ref,
        context='.',
        dockerfile='apps/{}/Dockerfile'.format(name),
        build_args={'SERVICE': name},
        only=[
            'apps/{}'.format(name),
            'packages',
            'pnpm-workspace.yaml',
            'pnpm-lock.yaml',
            'package.json',
            'tsconfig.base.json',
        ],
        live_update=[
            sync('apps/{}/src'.format(name), '/app/src'),
        ],
    )
    helm_resource(
        name,
        'charts/{}'.format(name),
        namespace='lw-idp',
        flags=['--create-namespace'],
        image_deps=[image_ref],
        image_keys=[('image.repository', 'image.tag')],
        labels=['backend'],
    )

# Web: Next.js, different Dockerfile
docker_build(
    '{}/web'.format(REGISTRY),
    context='.',
    dockerfile='apps/web/Dockerfile',
    only=[
        'apps/web',
        'packages',
        'pnpm-workspace.yaml',
        'pnpm-lock.yaml',
        'package.json',
        'tsconfig.base.json',
    ],
)
helm_resource(
    'web',
    'charts/web',
    namespace='lw-idp',
    flags=['--create-namespace'],
    image_deps=['{}/web'.format(REGISTRY)],
    image_keys=[('image.repository', 'image.tag')],
    labels=['frontend'],
)

print("""
lw-idp — Plan 1.2

Tilt UI: http://localhost:10350
Port-forward examples:
  kubectl -n lw-idp port-forward svc/gateway-svc 14000:80
  kubectl -n lw-idp port-forward svc/web 13001:80

Tear down:   Ctrl+C in this terminal, then `tilt down`.
""")
