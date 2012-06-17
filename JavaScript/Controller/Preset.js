var Core = require('Core');
var Element = Core.Element;
var Elements = Core.Elements;

var History = require('History');

var API = require('../API');
var Controller = require('./');
var View = require('../View');
var UI = require('../UI');

var SwipeAble = require('../UI/Actions/SwipeAble');

var presets = null;
var list = null;
var formdata = {};

var formatServices = function(services) {
  services.each(function(service) {
    var type = service.type;
    if (type == 'dropbox') type = type.charAt(0).toUpperCase() + type.slice(1);
    else type = service.type.toUpperCase();
    service.display_type = type;
  });

  return services;
};

var createFormatUIData = function(content) {
  var formats = API.getInfo('formats');
  var item = formats[content.format];
  var index = (item.bitrates ? item.bitrates.indexOf('' + content.bitrate) : 0); // Needs to be String
  return {
    title: item.display_name.replace(/\((.+?)\)/, '').trim(), // Remove parenthesis
    detail: item.bitrate_strings[index].replace(/\((.+?)\)/, '').trim(), // Remove parenthesis,
  };
};

var parseFormatsFromContainer = function(container) {
  var formats = API.getInfo('formats');
  return container.getChildren().retrieve('value').clean().map(function(format) {
    // Add filename if necessary
    var file = format.filename;
    var endings = formats[format.format].endings;
    var check = function(ending) {
      return file.indexOf('.' + ending) == file.length - 1 - ending.length;
    };
    if (file && !endings.some(check))
      format.filename += '.' + endings[0];

    return format;
  });
};

Controller.define('/preset', function() {

  API.call('presets.json').on({

    success: function(result) {
      list = result.data;

      presets = {};
      list.each(function(preset) {
        presets[preset.uuid] = preset;
      });

      View.get('Main').push('preset', new View.Object({
        title: 'Presets',
        content: UI.render('preset', {preset: list}),
        action: {
          title: 'New',
          url: '/preset/new'
        }
      }));
    }

  });

});

Controller.define('/preset/{uuid}', function(req) {

  // We need to create a new object that can be transformed for viewing
  var preset = Object.append({}, presets[req.uuid]);
  var metadata = preset.metadata;

  metadata.hasLicense = !!(metadata.license || metadata.license_url);
  preset.hasDetails = metadata.summary || metadata.publisher || metadata.url || metadata.hasLicense;

  if (preset.outgoings && preset.outgoings.length) formatServices(preset.outgoings);
  else preset.outgoings = null; // Be safe

  if (preset.algorithms) {
    var list = [];
    var algorithms = API.getInfo('algorithms');
    Object.each(preset.algorithms, function(value, algorithm) {
      if (!value) return;
      preset.hasAlgorithms = true;
      list.push(algorithms[algorithm]);
    });
    preset.algorithms = list;
  }

  if (preset.formats && preset.formats.length) {
    preset.formats = preset.formats.map(function(content) {
      return createFormatUIData(content);
    });
  } else {
    preset.formats = null;
  }

  View.get('Main').push('preset', new View.Object({
    title: preset.preset_name,
    content: UI.render('preset-detail', preset),
    action: {
      title: 'Edit',
      url: '/preset/edit/' + preset.uuid
    }
  }));

});

Controller.define('/preset/{uuid}/summary', function(req) {

  var preset = presets[req.uuid];
  View.get('Main').push('preset', new View.Object({
    title: preset.preset_name,
    content: UI.render('preset-detail-summary', preset)
  }));

});

var presetForm = function(req) {
  var object;
  View.get('Main').push('preset', object = new View.Object({
    title: 'New Preset',
    content: UI.render('preset-new', {
      algorithm: Object.values(Object.map(API.getInfo('algorithms'), function(content, algorithm) {
        return Object.append({key: algorithm}, content);
      }))
    }),
    action: {
      title: 'Save',
      url: '/preset/new/save',
      onClick: function() {
        var data = Object.append(object.serialize(), formdata.metadata, formdata.outgoings);
        data.formats = parseFormatsFromContainer(object.toElement().getElement('ul.output_formats'));

        API.call('presets.json', 'post', JSON.stringify(Object.expand(data)));
      }
    },

    onShow: function() {
      if (formdata.format) {
        var container = object.toElement().getElement('ul.output_formats');
        var content = formdata.format;
        var id = formdata.formatID || String.uniqueID();
        var previous = formdata.formatID ? container.getElement('[data-format-id=' + id + ']') : null;
        delete formdata.formatID;

        // Select-Values are Arrays but we only need the first and only value
        content.format = content.format[0];
        content.bitrate = content.bitrate[0];

        var element = Element.from(UI.render('ui-removable-list-item',
          Object.append(createFormatUIData(content), {
            label: 'Remove',
            href: '/preset/new/format/' + id
          })
        )).set('data-format-id', id).store('value', content);

        if (previous) element.replaces(previous);
        else element.inject(container);

        UI.update(container);

        // Store for editing
        if (!formdata.formats) formdata.formats = {};
        formdata.formats[id] = content;

        var instance = element.getInstanceOf(SwipeAble);
        if (instance) instance.addEvent('click', function() {
          if (formdata.formats) delete formdata.formats[id];
        });

        delete formdata.format;
      }
    },

    onHide: function(direction) {
      if (direction == 'left') formdata = {};
    }
  }));

};

Controller.define('/preset/new', {priority: 1, isGreedy: true}, presetForm);
Controller.define('/preset/edit/{uuid}', {priority: 1, isGreedy: true}, function(req) {
  var preset = presets[req.uuid];
  presetForm(req);
});

Controller.define('/preset/new/metadata', function(req) {

  View.get('Main').push('preset', new View.Object({
    title: 'Enter Metadata',
    content: UI.render('preset-new-metadata'),
    action: {
      title: 'Done',
      url: '/preset/new',
      onClick: function() {
        formdata.metadata = View.get('Main').getCurrentView().serialize();
      }
    },
    back: {
      title: 'Cancel'
    },

    onShow: function() {
      this.unserialize(formdata.metadata);
    }
  }));

});

Controller.define('/preset/new/format/:id:', function(req) {

  var list = [];
  var formats = API.getInfo('formats');
  Object.each(formats, function(value, key) {
    value = Object.append({}, value);
    value.value = key;
    value.bitrate_format = [];
    value.bitrate_strings.each(function(string, index) {
      var bitrate = (value.bitrates ? value.bitrates[index] : 0);
      value.bitrate_format.push({
        value: bitrate,
        title: string,
        selected: (!bitrate || bitrate == value.default_bitrate)
      });
    });
    list.push(value);
  });

  var object;
  View.get('Main').push('preset', object = new View.Object({
    title: 'Add Output Format',
    content: UI.render('preset-new-format', {
      format: list
    }),
    back: {
      title: 'Cancel'
    }
  }));

  var bitrateContainer = object.toElement().getElement('.bitrates').dispose();
  var selects = object.toElement().getElements('select.empty');
  selects.addEvents({

    'change:once': function() {
      View.get('Main').updateElement('action', {}, {
        title: req.id ? 'Done' : 'Add',
        url: '/preset/new',
        onClick: function() {
          formdata.format = View.get('Main').getCurrentView().serialize();
          if (req.id) formdata.formatID = req.id;
        }
      });
    },

    change: function() {
      var data = object.serialize();
      delete data.bitrate;
      delete data.format;

      var option = this.getSelected()[0];
      var value = option.get('value');
      var parent = this.getParent('ul');
      var item = bitrateContainer.getElement('[data-format=' + value + ']').clone();

      parent.getElements('> :not(li:first-child)').dispose();
      parent.adopt(item);

      Elements.from(UI.render('preset-new-format-detail')).inject(parent);

      // Restore previous values
      object.unserialize(data);
      UI.update(parent);
    }

  });

  // editing
  if (req.id && formdata.formats[req.id]) {
    object.unserialize({format: formdata.formats[req.id].format});
    selects.fireEvent('focus:once').fireEvent('change');
    object.unserialize(formdata.formats[req.id]);
  }
});

Controller.define('/preset/new/service', function(req) {

  API.call('services.json').on({

    success: function(result) {
      var services = formatServices(result.data);

      View.get('Main').push('preset', new View.Object({
        title: 'Outgoing Transfers',
        content: UI.render('preset-new-service', {
          service: services
        }),
        action: {
          title: 'Done',
          url: '/preset/new',
          onClick: function() {
            formdata.outgoings = View.get('Main').getCurrentView().serialize();
          }
        },
        back: {
          title: 'Cancel'
        },

        onShow: function() {
          this.unserialize(formdata.outgoings);
        }
      }));

    }
  });

});

Controller.define('/preset/new/save', function(req) {

  History.push('/preset');

});