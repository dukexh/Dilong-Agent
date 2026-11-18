import { localTask } from './local-api'
import type { DesignOptions } from '../core/types'
export type Platform = 'xiaohongshu'|'douyin'
export interface Post { id:string;platform:Platform;title:string;cover:string;author:string;url:string;publishedAt:string|null;collectedAt:string;metrics:Record<string,number|null> }
export interface PostPage { posts:Post[];cursor:string|null;notice:string }
export const platformNames = {xiaohongshu:'小红书',douyin:'抖音'}
export function searchPosts(platform:Platform,query:string,period:string,sort:string,cursor:string|null,options:DesignOptions={}) {
  return localTask<PostPage>('posts/search',{platform,query,period,sort,...cursor?{cursor}:{}},options)
}
