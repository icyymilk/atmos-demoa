export const providers = ['github', 'gitlab', 'notion'] as const;
export type Provider = typeof providers[number];
export type ConnectionStatus = { provider: Provider; account: string; verifiedAt: number };
export const connectionInfo = {
  github: { name: 'GitHub', description: '读取仓库、代码文件和 Issue，作为应用生成的素材。', url: 'https://github.com/settings/personal-access-tokens/new', help: '创建 Fine-grained token，选择需要的仓库，授予 Contents、Issues 的只读权限。', tools: ['list_repositories', 'search_repositories', 'read_file', 'list_issues'] },
  gitlab: { name: 'GitLab', description: '连接 GitLab.com，检索项目、读取目录、代码和 Issue。', url: 'https://gitlab.com/-/user_settings/personal_access_tokens', help: '创建 Personal access token，选择 read_api 权限。目前支持 GitLab.com。', tools: ['list_projects', 'list_files', 'read_file', 'list_issues'] },
  notion: { name: 'Notion', description: '搜索已授权页面，读取文档内容，让需求直接进入工作区。', url: 'https://www.notion.so/profile/integrations', help: '创建 Internal integration，启用 Read content，并在目标页面的 Connections 中添加该集成。', tools: ['search_pages', 'read_page', 'read_blocks'] },
} satisfies Record<Provider, { name: string; description: string; url: string; help: string; tools: string[] }>;
