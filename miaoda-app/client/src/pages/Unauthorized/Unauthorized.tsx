import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Card, CardContent } from '@client/src/components/ui/card';

const Unauthorized: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-md border shadow-none">
        <CardContent className="flex flex-col items-center gap-4 py-12 px-8">
          <div className="rounded-full bg-muted p-4">
            <Shield className="size-10 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">无访问权限</h1>
          <p className="text-sm text-muted-foreground text-center">
            您没有该页面的访问权限，请联系系统管理员申请
          </p>
          <Button
            variant="outline"
            className="mt-2"
            onClick={() => navigate('/')}
          >
            返回首页
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default Unauthorized;
