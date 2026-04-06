import type { FastifyReply, FastifyRequest } from 'fastify'
import type { BridgeStore } from './store.js'
import type { ClassRecord, SchoolMembershipRole, UserRole } from './types.js'

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

type ClassAccessResult =
  | {
      allowed: true
      classRecord: ClassRecord
    }
  | {
      allowed: false
      statusCode: 404
      body: {
        error: 'class_not_found'
        classId: string
      }
    }
  | {
      allowed: false
      statusCode: 403
      body: {
        error: 'forbidden'
        requiredScope: 'class_access'
        classId: string
      }
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

export async function checkUserClassAccess(
  store: Pick<BridgeStore, 'getClassRecord' | 'listClassMembershipsForUser' | 'listSchoolMembershipsForUser'>,
  input: {
    userId: string
    classId: string
    roles?: UserRole[]
  }
): Promise<ClassAccessResult> {
  const classRecord = await store.getClassRecord(input.classId)
  if (!classRecord) {
    return {
      allowed: false,
      statusCode: 404,
      body: {
        error: 'class_not_found',
        classId: input.classId,
      },
    }
  }

  if (input.roles?.includes('admin')) {
    return {
      allowed: true,
      classRecord,
    }
  }

  const classMemberships = await store.listClassMembershipsForUser(input.userId)
  const hasClassAccess = classMemberships.some((membership) => membership.classId === input.classId)
  if (hasClassAccess) {
    return {
      allowed: true,
      classRecord,
    }
  }

  if (classRecord.schoolId) {
    const schoolMemberships = await store.listSchoolMembershipsForUser(input.userId)
    const hasSchoolAdminAccess = schoolMemberships.some(
      (membership) => membership.schoolId === classRecord.schoolId && membership.membershipRole === 'school_admin'
    )
    if (hasSchoolAdminAccess) {
      return {
        allowed: true,
        classRecord,
      }
    }
  }

  return {
    allowed: false,
    statusCode: 403,
    body: {
      error: 'forbidden',
      requiredScope: 'class_access',
      classId: input.classId,
    },
  }
}

export async function resolveEntitledClassId(
  store: Pick<BridgeStore, 'getClassRecord' | 'listClassMembershipsForUser' | 'listSchoolMembershipsForUser'>,
  input: {
    userId: string
    roles?: UserRole[]
    requestedClassId?: string
    fallbackClassId?: string
  }
): Promise<
  | {
      classId?: string
      classRecord?: ClassRecord
    }
  | {
      denied: true
      statusCode: 403 | 404
      body: {
        error: 'forbidden'
        requiredScope: 'class_access'
        classId: string
      } | {
        error: 'class_not_found'
        classId: string
      }
    }
  >
{
  const candidateClassId = input.requestedClassId || input.fallbackClassId
  if (!candidateClassId) {
    return {}
  }

  const access = await checkUserClassAccess(store, {
    userId: input.userId,
    classId: candidateClassId,
    roles: input.roles,
  })

  if (!access.allowed) {
    return {
      denied: true,
      statusCode: access.statusCode,
      body: access.body,
    }
  }

  return {
    classId: candidateClassId,
    classRecord: access.classRecord,
  }
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

export async function requireSchoolGovernanceReadAccess(
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
    (membership) =>
      membership.schoolId === schoolId &&
      (membership.membershipRole === 'school_admin' || membership.membershipRole === 'teacher')
  )

  if (!hasAccess) {
    return reply.status(403).send({
      error: 'forbidden',
      requiredScope: 'school_governance_read',
      schoolId,
    })
  }

  return undefined
}

export async function requireAnyGovernanceWorkspaceAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  store: Pick<BridgeStore, 'listSchoolMembershipsForUser' | 'listClassMembershipsForUser'>
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

  const [schoolMemberships, classMemberships] = await Promise.all([
    store.listSchoolMembershipsForUser(userId),
    store.listClassMembershipsForUser(userId),
  ])

  const hasWorkspaceAccess =
    schoolMemberships.some(
      (membership) => membership.membershipRole === 'school_admin' || membership.membershipRole === 'teacher'
    ) || classMemberships.some((membership) => membership.membershipRole === 'teacher')

  if (!hasWorkspaceAccess) {
    return reply.status(403).send({
      error: 'forbidden',
      requiredScope: 'chatbridge_workspace',
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

  const access = await checkUserClassAccess(store, {
    userId,
    classId,
    roles: getRequestUserRoles(request),
  })

  if (access.allowed) {
    return undefined
  }

  return reply.status(access.statusCode).send(access.body)
}
