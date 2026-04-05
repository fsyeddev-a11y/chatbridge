import type { FastifyReply, FastifyRequest } from 'fastify'
import type { BridgeStore } from './store.js'
import type { SchoolMembershipRole, UserRole } from './types.js'

function getConfiguredUserRoleEmails(envValue: string | undefined) {
  return new Set(
    (envValue || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )
}

const ROLE_PRIORITY: UserRole[] = ['admin', 'school_admin', 'teacher', 'developer', 'student']

export function normalizeRoles(roles: UserRole[]) {
  return ROLE_PRIORITY.filter((role) => roles.includes(role))
}

export function selectPrimaryUserRole(roles: UserRole[]): UserRole {
  return normalizeRoles(roles)[0] || 'student'
}

export function resolveDefaultUserRoles(email?: string): UserRole[] {
  const normalizedEmail = email?.trim().toLowerCase()
  const adminEmails = getConfiguredUserRoleEmails(process.env.CHATBRIDGE_ADMIN_EMAILS)
  const schoolAdminEmails = getConfiguredUserRoleEmails(process.env.CHATBRIDGE_SCHOOL_ADMIN_EMAILS)
  const teacherEmails = getConfiguredUserRoleEmails(process.env.CHATBRIDGE_TEACHER_EMAILS)
  const developerEmails = getConfiguredUserRoleEmails(process.env.CHATBRIDGE_DEVELOPER_EMAILS)

  const roles: UserRole[] = []
  if (normalizedEmail && adminEmails.has(normalizedEmail)) {
    roles.push('admin')
  }
  if (normalizedEmail && schoolAdminEmails.has(normalizedEmail)) {
    roles.push('school_admin')
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

export function resolveDefaultSchoolMembershipRoles(email?: string, roles: UserRole[] = []): SchoolMembershipRole[] {
  const membershipRoles: SchoolMembershipRole[] = []
  if (roles.includes('school_admin')) {
    membershipRoles.push('school_admin')
  }
  if (roles.includes('teacher')) {
    membershipRoles.push('teacher')
  }
  if (roles.includes('student')) {
    membershipRoles.push('student')
  }

  return ['school_admin', 'teacher', 'student'].filter((role) => membershipRoles.includes(role as SchoolMembershipRole)) as SchoolMembershipRole[]
}

export function parseRequestUserRoles(headerValue: string | string[] | undefined): UserRole[] {
  const values = Array.isArray(headerValue) ? headerValue : typeof headerValue === 'string' ? headerValue.split(',') : []
  const roles = values
    .map((value) => value.trim())
    .filter((value): value is UserRole => ['admin', 'school_admin', 'teacher', 'student', 'developer'].includes(value))

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

export async function requireSchoolAdminForSchoolOrAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  store: Pick<BridgeStore, 'listSchoolMembershipsForUser'>,
  schoolId: string
) {
  const userId = getRequestUserId(request)
  if (!userId) {
    return reply.status(401).send({
      error: 'unauthorized',
    })
  }

  if (requestHasAnyRole(request, ['admin'])) {
    return undefined
  }

  const memberships = await store.listSchoolMembershipsForUser(userId)
  const hasAccess = memberships.some(
    (membership) => membership.schoolId === schoolId && membership.membershipRole === 'school_admin'
  )

  if (!hasAccess) {
    return reply.status(403).send({
      error: 'forbidden',
      requiredScope: 'school_admin',
      schoolId,
    })
  }

  return undefined
}

export async function requireTeacherForClassOrAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  store: Pick<BridgeStore, 'listClassMembershipsForUser'>,
  classId: string
) {
  const userId = getRequestUserId(request)
  if (!userId) {
    return reply.status(401).send({
      error: 'unauthorized',
    })
  }

  if (requestHasAnyRole(request, ['admin'])) {
    return undefined
  }

  const memberships = await store.listClassMembershipsForUser(userId)
  const hasAccess = memberships.some(
    (membership) => membership.classId === classId && membership.membershipRole === 'teacher'
  )

  if (!hasAccess) {
    return reply.status(403).send({
      error: 'forbidden',
      requiredScope: 'teacher_for_class',
      classId,
    })
  }

  return undefined
}

export async function requireClassAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  store: Pick<BridgeStore, 'getClassRecord' | 'listClassMembershipsForUser' | 'listSchoolMembershipsForUser'>,
  classId: string
) {
  const userId = getRequestUserId(request)
  if (!userId) {
    return reply.status(401).send({
      error: 'unauthorized',
    })
  }

  const classRecord = await store.getClassRecord(classId)
  if (!classRecord) {
    return reply.status(404).send({
      error: 'class_not_found',
    })
  }

  if (requestHasAnyRole(request, ['admin'])) {
    return undefined
  }

  const classMemberships = await store.listClassMembershipsForUser(userId)
  const hasClassAccess = classMemberships.some((membership) => membership.classId === classId)
  if (hasClassAccess) {
    return undefined
  }

  if (classRecord.schoolId) {
    const schoolMemberships = await store.listSchoolMembershipsForUser(userId)
    const hasSchoolAdminAccess = schoolMemberships.some(
      (membership) => membership.schoolId === classRecord.schoolId && membership.membershipRole === 'school_admin'
    )
    if (hasSchoolAdminAccess) {
      return undefined
    }
  }

  return reply.status(403).send({
    error: 'forbidden',
    requiredScope: 'class_access',
    classId,
  })
}
