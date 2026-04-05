import type { FastifyReply, FastifyRequest } from 'fastify'
import type { UserRole } from './types.js'

function getConfiguredUserRoleEmails(envValue: string | undefined) {
  return new Set(
    (envValue || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )
}

const ROLE_PRIORITY: UserRole[] = ['admin', 'teacher', 'developer', 'student']

export function normalizeRoles(roles: UserRole[]) {
  return ROLE_PRIORITY.filter((role) => roles.includes(role))
}

export function selectPrimaryUserRole(roles: UserRole[]): UserRole {
  return normalizeRoles(roles)[0] || 'student'
}

export function resolveDefaultUserRoles(email?: string): UserRole[] {
  const normalizedEmail = email?.trim().toLowerCase()
  const adminEmails = getConfiguredUserRoleEmails(process.env.CHATBRIDGE_ADMIN_EMAILS)
  const teacherEmails = getConfiguredUserRoleEmails(process.env.CHATBRIDGE_TEACHER_EMAILS)
  const developerEmails = getConfiguredUserRoleEmails(process.env.CHATBRIDGE_DEVELOPER_EMAILS)

  const roles: UserRole[] = []
  if (normalizedEmail && adminEmails.has(normalizedEmail)) {
    roles.push('admin')
  }
  if (normalizedEmail && teacherEmails.has(normalizedEmail)) {
    roles.push('teacher')
  }
  if (normalizedEmail && developerEmails.has(normalizedEmail)) {
    roles.push('developer')
  }

  if (roles.length === 0) {
    roles.push('student')
  }

  return normalizeRoles(roles)
}

export function parseRequestUserRoles(headerValue: string | string[] | undefined): UserRole[] {
  const values = Array.isArray(headerValue) ? headerValue : typeof headerValue === 'string' ? headerValue.split(',') : []
  const roles = values
    .map((value) => value.trim())
    .filter((value): value is UserRole => ['admin', 'teacher', 'student', 'developer'].includes(value))

  return normalizeRoles(roles)
}

export function getRequestUserId(request: FastifyRequest) {
  const userId = request.headers['x-chatbridge-user-id']
  return typeof userId === 'string' ? userId : undefined
}

export function getRequestUserEmail(request: FastifyRequest) {
  const userEmail = request.headers['x-chatbridge-user-email']
  return typeof userEmail === 'string' ? userEmail : undefined
}

export function getRequestUserRoles(request: FastifyRequest) {
  return parseRequestUserRoles(request.headers['x-chatbridge-user-roles'])
}

export function requestHasAnyRole(request: FastifyRequest, expectedRoles: UserRole[]) {
  const roles = getRequestUserRoles(request)
  return expectedRoles.some((role) => roles.includes(role))
}

export function requireAnyRole(request: FastifyRequest, reply: FastifyReply, expectedRoles: UserRole[]) {
  const userId = getRequestUserId(request)
  if (!userId) {
    return reply.status(401).send({
      error: 'unauthorized',
    })
  }

  if (!requestHasAnyRole(request, expectedRoles)) {
    return reply.status(403).send({
      error: 'forbidden',
      requiredRoles: expectedRoles,
    })
  }

  return undefined
}
