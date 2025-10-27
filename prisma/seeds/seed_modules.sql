-- MÓDULOS BASE (solo inserta si no existen)
INSERT INTO "LibraryModule" ("key","name","description")
SELECT 'auth','Autenticación y Usuarios','Gestión de usuarios, roles, permisos, SSO/MFA'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryModule" WHERE "key"='auth');

INSERT INTO "LibraryModule" ("key","name","description")
SELECT 'integraciones','Integraciones Externas','Conectores, APIs y webhooks'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryModule" WHERE "key"='integraciones');

INSERT INTO "LibraryModule" ("key","name","description")
SELECT 'workflows','Automatización de Procesos','Reglas, orquestación y BPMN'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryModule" WHERE "key"='workflows');

INSERT INTO "LibraryModule" ("key","name","description")
SELECT 'reporting','Reportes y Analítica','KPIs, dashboards, exportaciones'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryModule" WHERE "key"='reporting');

INSERT INTO "LibraryModule" ("key","name","description")
SELECT 'monitoring','Monitoreo y Observabilidad','Logs, métricas, alertas'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryModule" WHERE "key"='monitoring');

INSERT INTO "LibraryModule" ("key","name","description")
SELECT 'security','Seguridad y Auditoría','Hardening, auditoría y compliance'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryModule" WHERE "key"='security');

INSERT INTO "LibraryModule" ("key","name","description")
SELECT 'billing','Facturación y Pagos','Planes, pasarelas e impuestos'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryModule" WHERE "key"='billing');

INSERT INTO "LibraryModule" ("key","name","description")
SELECT 'comms','Comunicaciones','Email/SMS/Push/WhatsApp'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryModule" WHERE "key"='comms');

INSERT INTO "LibraryModule" ("key","name","description")
SELECT 'analytics','Paneles de Análisis','Paneles ejecutivos y funnels'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryModule" WHERE "key"='analytics');

INSERT INTO "LibraryModule" ("key","name","description")
SELECT 'notifications','Sistema de Notificaciones','Notificaciones transaccionales'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryModule" WHERE "key"='notifications');

INSERT INTO "LibraryModule" ("key","name","description")
SELECT 'compliance','Gestión de Cumplimiento','KYC/AML, PEP screening, auditorías'
WHERE NOT EXISTS (SELECT 1 FROM "LibraryModule" WHERE "key"='compliance');
