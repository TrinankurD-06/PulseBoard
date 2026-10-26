import { ROLES } from '@pulseboard/shared/constants';
import { Membership, User } from '@pulseboard/shared/models';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { paginate } from '../../lib/pagination.js';

function toMemberDto(membership) {
  const user = membership.userId;
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: membership.role,
    joinedAt: membership.createdAt,
  };
}

export async function listMembers(workspaceId, pagination) {
  const result = await paginate(Membership, { workspaceId }, pagination, (query) =>
    query.sort({ createdAt: 1 }).populate('userId', 'name email'),
  );
  return {
    ...result,
    data: result.data.filter((membership) => membership.userId).map(toMemberDto),
  };
}

/** Adds an existing PulseBoard user to the workspace. */
export async function addMember(workspaceId, { email, role }) {
  const user = await User.findOne({ email });
  if (!user) {
    throw notFound('No PulseBoard account uses that email. Ask them to sign up first.');
  }
  try {
    const membership = await Membership.create({ workspaceId, userId: user._id, role });
    membership.userId = user;
    return toMemberDto(membership);
  } catch (err) {
    if (err.code === 11000) throw conflict('That user is already a member of this workspace');
    throw err;
  }
}

/**
 * A workspace must always keep at least one owner, otherwise nobody could
 * manage members or delete it.
 */
async function assertNotLastOwner(workspaceId, membership) {
  if (membership.role !== ROLES.OWNER) return;
  const owners = await Membership.countDocuments({ workspaceId, role: ROLES.OWNER });
  if (owners <= 1) {
    throw new AppError(409, 'LAST_OWNER', 'A workspace must keep at least one owner');
  }
}

async function findMembership(workspaceId, userId) {
  const membership = await Membership.findOne({ workspaceId, userId });
  if (!membership) throw notFound('Member not found');
  return membership;
}

export async function changeMemberRole(workspaceId, userId, role) {
  const membership = await findMembership(workspaceId, userId);
  if (role !== ROLES.OWNER) await assertNotLastOwner(workspaceId, membership);
  membership.role = role;
  await membership.save();
  await membership.populate('userId', 'name email');
  return toMemberDto(membership);
}

export async function removeMember(workspaceId, userId) {
  const membership = await findMembership(workspaceId, userId);
  await assertNotLastOwner(workspaceId, membership);
  await membership.deleteOne();
}
