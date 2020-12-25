import SteamId from "steamid";
import {EPersonaState, EChatEntryType, EChatRoomServerMessage} from "./enum";

export interface IIncomingFriendMessage {
	steamid_friend: SteamId,
	chat_entry_type: EChatEntryType,
	from_limited_account: boolean,
	message: string,
	message_no_bbcode: string,
	server_timestamp: Date,
	ordinal: number,
	local_echo: boolean,
	low_priority: boolean
	message_bbcode_parsed: BBCodeField[]
}

export type BBCodeField = BBCodeNode | string;

export interface BBCodeNode {
	tag: string
	attrs: { [attr: string]: string },
	content: BBCodeField[]
}

export interface IIncomingChatMessage {
	chat_group_id: string,
	chat_id: string,
	chat_name: string,
	steamid_sender: SteamId,
	chat_entry_type?: EChatEntryType,
	from_limited_account?: boolean,
	message: string,
	message_no_bbcode: string,
	message_bbcode_parsed: BBCodeField[]
	server_timestamp: Date,
	ordinal: number,
	mentions: IChatMentions | null,
}

export interface IChatMentions {
	mention_all: boolean,
	mention_here,
	mention_steamids: SteamId[]
}

export interface IServerMessage {
	message: EChatRoomServerMessage,
	string_param?: string,
	steamid_param?: SteamId
}

// incomplete
export interface IPersona {
	persona_state: EPersonaState,
	player_name: string,
	avatar_hash: Buffer,
	last_logoff: Date,
	last_logon: Date,
	last_seen_online: Date,
	game_name: string,
	gameid: string,
	avatar_url_icon: string,
	avatar_url_medium: string,
	avatar_url_full: string
}

export interface AppInfo {
	changenumber: number,
	missingToken: boolean,
	appinfo: {
		appid: string,
		common: {
			name: string,
			type: string,
			releasestate: string,
			oslist: string,
			logo: string,
			logo_small: string,
			icon: string,
		},
		extended: {
			developer: string,
			publisher: string,
			homepage: string,
			listofdlc: string
		}
	}
}

export interface IGroupInfo {
	chat_group_id: string,
	default_chat_id: string,
	chat_rooms: {
		chat_id: string,
		chat_name: string,
	}[]
}

export interface IGroupDetails {
	group_summary: {
		chat_rooms: {
			members_in_voice: SteamId[],
			chat_id: string,
			chat_name: string,
			voice_allowed: boolean,
			time_last_message: Date,
			sort_order: null,
			last_message: string,
			steamid_last_message: SteamId
		}[],
		top_members: SteamId[],
		role_ids: any[],
		role_actions: any[],
		party_beacons: [],
		chat_group_id: string,
		chat_group_name: string,
		active_member_count: number,
		active_voice_member_count: number,
		default_chat_id: string,
		chat_group_tagline: string,
		chat_group_avatar_sha: Buffer,
		rank: number,
		default_role_id: string,
		steamid_owner: SteamId,
		chat_group_avatar_url?: string,
	},
	group_state: {
		user_chat_room_state: any[],
		chat_group_id: string,
		time_joined: Date,
		desktop_notification_level: number,
		mobile_notification_level: number,
		time_last_group_ack: Date,
		unread_indicator_muted: boolean
	}
}
