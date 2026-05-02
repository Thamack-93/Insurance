"use client";

import { PGLogo } from "./pg-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function BrandingShowcase() {
  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-stone-900">PG Branding Proposals</h1>
        <p className="text-stone-600">Choose your preferred logo style for the insurance management system</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Modern Interlocking */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <PGLogo variant="default" size="lg" />
              Modern Interlocking
            </CardTitle>
            <CardDescription>
              Professional letterforms that interlock P and G with clean geometric shapes
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-center p-8 bg-stone-50 rounded-lg">
              <PGLogo variant="default" size="xl" />
            </div>
            <div className="flex justify-center gap-4">
              <PGLogo variant="default" size="sm" />
              <PGLogo variant="default" size="md" />
              <PGLogo variant="default" size="lg" />
              <PGLogo variant="default" size="xl" />
            </div>
          </CardContent>
        </Card>

        {/* Minimal Text */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <PGLogo variant="minimal" size="lg" />
              Minimal Text
            </CardTitle>
            <CardDescription>
              Clean, minimalist typography approach with bold lettering
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-center p-8 bg-stone-50 rounded-lg">
              <PGLogo variant="minimal" size="xl" />
            </div>
            <div className="flex justify-center gap-4">
              <PGLogo variant="minimal" size="sm" />
              <PGLogo variant="minimal" size="md" />
              <PGLogo variant="minimal" size="lg" />
              <PGLogo variant="minimal" size="xl" />
            </div>
          </CardContent>
        </Card>

        {/* Monogram Circle */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <PGLogo variant="monogram" size="lg" />
              Monogram Circle
            </CardTitle>
            <CardDescription>
              Classic circular badge with initials inside - traditional and trustworthy
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-center p-8 bg-stone-50 rounded-lg">
              <PGLogo variant="monogram" size="xl" />
            </div>
            <div className="flex justify-center gap-4">
              <PGLogo variant="monogram" size="sm" />
              <PGLogo variant="monogram" size="md" />
              <PGLogo variant="monogram" size="lg" />
              <PGLogo variant="monogram" size="xl" />
            </div>
          </CardContent>
        </Card>

        {/* Badge Style */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <PGLogo variant="badge" size="lg" />
              Badge Style
            </CardTitle>
            <CardDescription>
              Modern circular badge with white text on dark background - app-style
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-center p-8 bg-stone-50 rounded-lg">
              <PGLogo variant="badge" size="xl" />
            </div>
            <div className="flex justify-center gap-4">
              <PGLogo variant="badge" size="sm" />
              <PGLogo variant="badge" size="md" />
              <PGLogo variant="badge" size="lg" />
              <PGLogo variant="badge" size="xl" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="text-center space-y-4">
        <h2 className="text-xl font-semibold text-stone-900">Color Variations</h2>
        <div className="flex justify-center gap-8 flex-wrap">
          <div className="text-center">
            <div className="p-4 bg-stone-900 rounded-lg mb-2">
              <PGLogo variant="default" size="lg" className="text-white" />
            </div>
            <span className="text-sm text-stone-600">Dark</span>
          </div>
          <div className="text-center">
            <div className="p-4 bg-white border border-stone-200 rounded-lg mb-2">
              <PGLogo variant="default" size="lg" />
            </div>
            <span className="text-sm text-stone-600">Light</span>
          </div>
          <div className="text-center">
            <div className="p-4 bg-blue-600 rounded-lg mb-2">
              <PGLogo variant="default" size="lg" className="text-white" />
            </div>
            <span className="text-sm text-stone-600">Blue</span>
          </div>
          <div className="text-center">
            <div className="p-4 bg-emerald-600 rounded-lg mb-2">
              <PGLogo variant="default" size="lg" className="text-white" />
            </div>
            <span className="text-sm text-stone-600">Emerald</span>
          </div>
        </div>
      </div>
    </div>
  );
}
