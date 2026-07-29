// Controller layer — HTTP entry points only. Business logic lives in ../services.
import { getUser, getUserProfile } from '../services/userService';

export async function handleGetUser(id: string) {
	return getUser(id);
}

export async function handleGetUserProfile(id: string) {
	return getUserProfile(id);
}
