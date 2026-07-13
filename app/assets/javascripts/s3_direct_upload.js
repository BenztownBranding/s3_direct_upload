//= require jquery-fileupload/basic
//= require jquery-fileupload/vendor/tmpl

(function() {
  var $ = jQuery;

  $.fn.S3Uploader = function(options) {

    // support multiple elements
    if (this.length > 1) {
      this.each(function() {
        $(this).S3Uploader(options);
      });

      return this;
    }

    var $uploadForm = this;

    var settings = {
      path: '',
      additional_data: null,
      before_add: null,
      before_add_async: null,
      after_add: null,
      remove_completed_progress_bar: true,
      remove_failed_progress_bar: false,
      progress_bar_target: null,
      click_submit_target: null,
      allow_multiple_files: true
    };

    $.extend(settings, options);

    var current_files = [];
    var forms_for_submit = [];
    if (settings.click_submit_target) {
      settings.click_submit_target.click(function() {
        for (var i = 0; i < forms_for_submit.length; i++) {
          forms_for_submit[i].submit();
        }
        return false;
      });
    }

    var setUploadForm = function() {
      $uploadForm.fileupload({

        add: function(e, data) {
          var file = data.files[0];
          file.unique_id = Math.random().toString(36).substr(2, 16);

          var addFile = function() {
            current_files.push(data);
            if ($('#template-upload').length > 0) {
              data.context = $($.trim(tmpl("template-upload", file)));
              $(data.context).appendTo(settings.progress_bar_target || $uploadForm);
            } else if (!settings.allow_multiple_files) {
              data.context = settings.progress_bar_target;
            }
            if (settings.click_submit_target) {
              if (settings.allow_multiple_files) {
                forms_for_submit.push(data);
              } else {
                forms_for_submit = [data];
              }
            } else {
              data.submit();
            }
            if (settings.after_add) {
              settings.after_add();
            }
          };

          if (settings.before_add_async) {
            settings.before_add_async(file).then(function(result) {
              if (result) {
                addFile(data);
              }
            });
          } else {
            if (!(settings.before_add && !settings.before_add(file))) {
              addFile();
            }
          }
        },

        start: function(e) {
          $uploadForm.trigger("s3_uploads_start", [e]);
        },

        progress: function(e, data) {
          if (data.context) {
            var progress = parseInt(data.loaded / data.total * 100, 10);
            data.context.find('.bar').css('width', progress + '%');
          }
        },

        done: function(e, data) {
          var content = build_content_object($uploadForm, data.files[0], data.result);

          var callback_url = $uploadForm.data('callback-url');
          if (callback_url) {
            content[$uploadForm.data('callback-param')] = content.url;

            $.ajax({
              type: $uploadForm.data('callback-method'),
              url: callback_url,
              data: content,
              beforeSend: function(xhr, settings) { $uploadForm.trigger('ajax:beforeSend', [xhr, settings]); },
              complete: function(xhr, status) { $uploadForm.trigger('ajax:complete', [xhr, status]); },
              success: function(data, status, xhr) { $uploadForm.trigger('ajax:success', [data, status, xhr]); },
              error: function(xhr, status, error) { $uploadForm.trigger('ajax:error', [xhr, status, error]); }
            });
          }

          if (data.context && settings.remove_completed_progress_bar) {
            data.context.remove(); // remove progress bar
          }
          $uploadForm.trigger("s3_upload_complete", [content]);

          current_files.splice($.inArray(data, current_files), 1); // remove that element from the array
          if (!current_files.length) {
            $uploadForm.trigger("s3_uploads_complete", [content]);
          }
        },

        fail: function(e, data) {
          var content = build_content_object($uploadForm, data.files[0], data.result);
          content.error_thrown = data.errorThrown;

          if (data.context && settings.remove_failed_progress_bar) {
            data.context.remove(); // remove progress bar
          }
          $uploadForm.trigger("s3_upload_failed", [content]);
        },

        formData: function(form) {
          var data = form.serializeArray();
          var fileType = "";
          if ("type" in this.files[0]) {
            fileType = this.files[0].type;
          }
          data.push({
            name: "content-type",
            value: fileType
          });

          var key = $uploadForm.data("key")
            .replace('{timestamp}', new Date().getTime())
            .replace('{unique_id}', this.files[0].unique_id)
            .replace('{extension}', this.files[0].name.split('.').pop());

          // substitute upload timestamp and unique_id into key
          var key_field = $.grep(data, function(n) {
            if (n.name === "key") {
              return n;
            }
          });

          if (key_field.length > 0) {
            key_field[0].value = settings.path + key;
          }

          // IE <= 9 doesn't have XHR2 hence it can't use formData
          // replace 'key' field to submit form
          if (!('FormData' in window)) {
            $uploadForm.find("input[name='key']").val(settings.path + key);
          }
          return data;
        }
      });
    };

    var build_content_object = function($uploadForm, file, result) {
      var content = {};
      if (result) { // Use the S3 response to set the URL to avoid character encodings bugs
        content.url      = $(result).find("Location").text();
        content.filepath = $('<a />').attr('href', content.url)[0].pathname;
      } else { // IE <= 9 return a null result object so we use the file object instead
        var domain       = $uploadForm.attr('action');
        content.filepath = $uploadForm.find('input[name=key]').val().replace('/${filename}', '');
        content.url      = domain + content.filepath + '/' + encodeURIComponent(file.name);
      }

      content.filename = file.name;
      if ('size' in file) content.filesize = file.size;
      if ('lastModifiedDate' in file) content.lastModifiedDate = file.lastModifiedDate;
      if ('type' in file) content.filetype = file.type;
      if ('unique_id' in file) content.unique_id = file.unique_id;
      if (has_relativePath(file)) content.relativePath = build_relativePath(file);
      if (settings.additional_data) content = $.extend(content, settings.additional_data);
      return content;
    };

    var has_relativePath = function(file) {
      return file.relativePath || file.webkitRelativePath;
    };

    var build_relativePath = function(file) {
      return file.relativePath || (file.webkitRelativePath ? file.webkitRelativePath.split("/").slice(0, -1).join("/") + "/" : undefined);
    };

    // public methods
    this.initialize = function() {
      // Save key for IE9 Fix
      $uploadForm.data("key", $uploadForm.find("input[name='key']").val());

      setUploadForm();
      return this;
    };

    this.path = function(new_path) {
      return settings.path = new_path;
    };

    this.additional_data = function(new_data) {
      return settings.additional_data = new_data;
    };

    return this.initialize();
  };

}).call(this);
