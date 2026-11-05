import {avatarRevision} from './avatarRevision.js';
export const AVATAR_COUNT=80;
export const avatarName=()=> 'Avatar';
export default function AvatarImage({id=0}) {
  const safe=Number.isInteger(id)&&id>=0&&id<AVATAR_COUNT?id:0;
  return <img src={`${import.meta.env.BASE_URL}avatars/${String(safe).padStart(2,'0')}.webp?v=${avatarRevision}`} alt={avatarName(safe)} width="128" height="128" loading="lazy" decoding="async"/>;
}
