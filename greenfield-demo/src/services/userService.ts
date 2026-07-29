// Service layer — business logic. Talks to repositories, never to HTTP directly.
import { findUser, findUserProfile, removeUser } from '../repositories/userRepository';

export async function getUser(id: string) {
	const user = await findUser(id);
	if (!user) {
		throw new Error(`User ${id} not found`);
	}
	return user;
}

export async function getUserProfile(id: string) {
	const profile = await findUserProfile(id);
	if (!profile) {
		throw new Error(`User ${id} not found`);
	}
	return profile;
}

export async function deleteUser(id: string) {
	const user = await findUser(id);
	if (!user) {
		throw new Error(`User ${id} not found`);
	}
	await removeUser(id);
	return user;
}
