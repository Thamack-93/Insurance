"use client";

import { useState } from "react";
import { Upload, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { documentTypeOptions } from "@/lib/domain-options";
import { cn } from "@/lib/utils";

interface UploadFormProps {
  onSuccess?: (document: any) => void;
  onError?: (error: string) => void;
  associations?: {
    clientId?: string;
    policyId?: string;
    receiptId?: string;
    taskId?: string;
    claimId?: string;
    quoteId?: string;
  };
  className?: string;
}

export function UploadForm({ 
  onSuccess, 
  onError, 
  associations = {},
  className 
}: UploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<{
    documentType: string;
    notes: string;
    clientId?: string;
    policyId?: string;
    receiptId?: string;
    taskId?: string;
    claimId?: string;
    quoteId?: string;
  }>({
    documentType: "",
    notes: "",
    ...associations,
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Validate file type
      const allowedTypes = [
        "application/pdf",
        "image/jpeg",
        "image/png",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];

      if (!allowedTypes.includes(selectedFile.type)) {
        setError("Only PDF, JPG, PNG, and Word documents are allowed");
        return;
      }

      // Validate file size (10MB)
      if (selectedFile.size > 10 * 1024 * 1024) {
        setError("File size must be less than 10MB");
        return;
      }

      setFile(selectedFile);
      setError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!file) {
      setError("Please select a file");
      return;
    }

    if (!formData.documentType) {
      setError("Please select a document type");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formDataToSend = new FormData();
      formDataToSend.append("file", file);
      
      Object.entries(formData).forEach(([key, value]) => {
        if (value) {
          formDataToSend.append(key, value);
        }
      });

      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formDataToSend,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Upload failed");
      }

      onSuccess?.(result.document);
      
      // Reset form
      setFile(null);
      setFormData({ documentType: "", notes: "", ...associations });
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Upload failed";
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className={cn("w-full max-w-2xl", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="size-5" />
          Upload Document
        </CardTitle>
        <CardDescription>
          Upload PDFs, images, or Word documents. Max file size: 10MB.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <div className="flex items-center gap-2 text-red-800">
              <AlertCircle className="size-4" />
              <span className="text-sm">{error}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="file">File</Label>
            <div className="flex items-center gap-2">
              <Input
                id="file"
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                disabled={uploading}
                className="flex-1"
              />
              {file && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="size-4" />
                  {file.name}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="documentType">Document Type</Label>
            <Select
              value={formData.documentType}
              onValueChange={(value) => setFormData(prev => ({ ...prev, documentType: value || "" }))}
              disabled={uploading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select document type" />
              </SelectTrigger>
              <SelectContent>
                {documentTypeOptions.map((option: { value: string; label: string }) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {associations.clientId && (
            <div className="text-sm text-muted-foreground">
              Will be associated with the selected client
            </div>
          )}

          {associations.policyId && (
            <div className="text-sm text-muted-foreground">
              Will be associated with the selected policy
            </div>
          )}

          {associations.receiptId && (
            <div className="text-sm text-muted-foreground">
              Will be associated with the selected receipt
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Add any additional notes about this document..."
              disabled={uploading}
              rows={3}
            />
          </div>

          <Button type="submit" disabled={uploading || !file} className="w-full">
            {uploading ? "Uploading..." : "Upload Document"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
