import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  FolderTree,
  FileDown,
  Rocket,
  Settings,
} from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Outlet } from 'react-router-dom';
import { useAppInfo } from '@lark-apaas/client-toolkit/hooks/useAppInfo';
import { useCurrentUserProfile } from '@lark-apaas/client-toolkit/hooks/useCurrentUserProfile';
import { CanRole } from '@lark-apaas/client-toolkit/auth';

const navItems = [
  { path: '/', label: '运营工作台', icon: LayoutDashboard, roles: null },
  { path: '/documents', label: '内容管理', icon: FileText, roles: null },
  { path: '/categories', label: '目录设置', icon: FolderTree, roles: ['super_admin', 'publish_admin'] },
  { path: '/import/feishu', label: '导入工具', icon: FileDown, roles: ['super_admin', 'publish_admin'] },
  { path: '/publish-center', label: '发布中心', icon: Rocket, roles: ['super_admin', 'publish_admin', 'content_editor'] },
  { path: '/system-config', label: '系统配置', icon: Settings, roles: ['super_admin', 'publish_admin'] },
];

const LayoutContent = () => {
  const { pathname } = useLocation();
  const { appName } = useAppInfo();
  const userInfo = useCurrentUserProfile();

  const activeItem = navItems.find(
    (item) => item.path === pathname
  );
  const activeTitle = activeItem?.label ?? 'ODPM 帮助中心';

  const displayName = userInfo?.name || '';
  const avatarUrl = userInfo?.avatar;
  const isLoggedIn = !!userInfo?.user_id;

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/">
                  <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-md text-sm font-bold">
                    O
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-semibold">
                      {appName || 'ODPM 帮助中心'}
                    </span>
                    <span className="text-muted-foreground text-xs truncate">
                      管理系统
                    </span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const menuItem = (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        asChild
                        isActive={
                          item.path === '/'
                            ? pathname === '/'
                            : pathname.startsWith(item.path)
                        }
                        tooltip={item.label}
                      >
                        <Link to={item.path}>
                          <item.icon className="size-4" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );

                  if (item.roles) {
                    return (
                      <CanRole key={item.path} roles={item.roles} fallback={null}>
                        {menuItem}
                      </CanRole>
                    );
                  }

                  return menuItem;
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="pointer-events-none">
                <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-muted overflow-hidden">
                  {isLoggedIn && avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt=""
                      className="size-8 rounded-md object-cover"
                    />
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      {isLoggedIn ? displayName?.charAt(0) || 'U' : '?'}
                    </span>
                  )}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate font-medium">
                    {isLoggedIn ? displayName : '游客'}
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center gap-2 px-6 h-14 border-b shrink-0">
          <SidebarTrigger className="-ml-2" />
          <span className="font-medium text-foreground">{activeTitle}</span>
        </header>
        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>
      </main>
    </>
  );
};

const Layout = () => {
  return (
    <SidebarProvider>
      <LayoutContent />
    </SidebarProvider>
  );
};

export default Layout;
