import { NextResponse } from "next/server";

export function ok<T>(data: T, meta?: Record<string, unknown>) {
  return NextResponse.json({ data, ...(meta ? { meta } : {}) }, { status: 200 });
}

export function created<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code: "BAD_REQUEST", message, details } },
    { status: 400 }
  );
}

export function unauthorized(message = "No autenticado") {
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message } },
    { status: 401 }
  );
}

export function forbidden(message = "Sin permisos para esta acción") {
  return NextResponse.json(
    { error: { code: "FORBIDDEN", message } },
    { status: 403 }
  );
}

export function notFound(message = "Recurso no encontrado") {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message } },
    { status: 404 }
  );
}

export function conflict(message: string) {
  return NextResponse.json(
    { error: { code: "CONFLICT", message } },
    { status: 409 }
  );
}

export function serverError(message = "Error interno del servidor", details?: unknown) {
  console.error("[SERVER_ERROR]", message, details);
  return NextResponse.json(
    { error: { code: "SERVER_ERROR", message } },
    { status: 500 }
  );
}
