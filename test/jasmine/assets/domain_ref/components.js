// Test the placement of Axis Referencing Objects (AROs)
// Tools that can be wrapped in Jasmine tests.
//
// TODO: To make it work with Jasmine, we need to return a list of promises,
// one for each combination in the combo. When we're debugging / exploring, we
// want to be able to call the promise from the browser. When in a jasmine
// test, we need a description of the test and the promise doing the test
// itself. In this case, it needs to tell jasmine if it passed or failed, so we
// pass in an assert function that the promise can call. Then in jasmine, the
// promise is followed by .catch(failTest).then(done)
'use strict'

var Plotly = require('../../../../lib/index');
var d3 = require('d3');
var createGraphDiv = require('../../assets/create_graph_div');
var destroyGraphDiv = require('../../assets/destroy_graph_div');
var pixelCalc = require('../../assets/pixel_calc');
var getSVGElemScreenBBox = require(
    '../../assets/get_svg_elem_screen_bbox');
var Lib = require('../../../../src/lib');
var Axes = require('../../../../src/plots/cartesian/axes');
var axisIds = require('../../../../src/plots/cartesian/axis_ids');
var testImage = 'https://images.plot.ly/language-icons/api-home/js-logo.png';
var iterable = require('extra-iterable');
var delay = require('../../assets/delay');

var testMock = Lib.extendDeep({},
    require('../../../image/mocks/domain_ref_base.json'));

// NOTE: this tolerance is in pixels
var EQUALITY_TOLERANCE = 1e-2;

var DEBUG = true;

var it = function(s, f) {
    console.log('testing ' + s);
    f(function() {
        console.log(s + ' is done.');
    });
}

// acts on an Object representing a aro which could be a line or a rect
// DEPRECATED
function aroFromAROPos(aro, axletter, axnum, aropos) {
    aro[axletter + '0'] = aropos.value[0];
    aro[axletter + '1'] = aropos.value[1];
    if (aropos.ref === 'range') {
        aro[axletter + 'ref'] = axletter + axnum;
    } else if (aropos.ref === 'domain') {
        aro[axletter + 'ref'] = axletter + axnum + ' domain';
    } else if (aropos.ref === 'paper') {
        aro[axletter + 'ref'] = 'paper';
    }
}



// {axid} is the axis id, e.g., x2, y, etc.
// {ref} is ['range'|'domain'|'paper']
function makeAxRef(axid, ref) {
    var axref;
    switch (ref) {
        case 'range':
            axref = axid;
            break;
        case 'domain':
            axref = axid + ' domain';
            break;
        case 'paper':
            axref = 'paper';
            break;
        default:
            throw 'Bad axis type (ref): ' + ref;
    }
    return axref;
}

// set common parameters of an ARO
// {aro} is the object whose parameters to set
// {coordletter} the letter of the coordinate to assign
// {axref} is the axis the coordinate refers to
// {value} is the value of the first coordinate (e.g., x0 if axletter is x)
function aroSetCommonParams(aro, coordletter, axref, value) {
    aro[coordletter + '0'] = value;
    aro.axref = axref;
}

// shape, annotation and image all take x0, y0, xref, yref, color parameters
// x0, y0 are numerical values, xref, yref are strings that could be passed to
// the xref field of an ANO (e.g., 'x2 domain' or 'paper'), color should be
// specified using the 'rgb(r, g, b)' syntax
// arotype can be 'shape', 'annotation', or 'image'
// shapes take type=[line|rect], x1, y1
// annotations take ax, ay, axref, ayref, (text is just set to "A" and xanchor
// and yanchor are always set to left because these are text attributes which we
// don't test)
// images take xsize, ysize, xanchor, yanchor (sizing is set to stretch for simplicity
// in computing the bounding box and source is something predetermined)
function aroFromParams(arotype, x0, y0, xref, yref, color, opts) {
    // fill with common values
    var aro = {
        xref: xref,
        yref: yref
    };
    switch (arotype) {
        case 'shape':
            aro.x0 = x0;
            aro.y0 = y0;
            aro.x1 = opts.x1;
            aro.y1 = opts.y1;
            aro.type = opts.type;
            aro.line = {
                color: color
            };
            break;
        case 'annotation':
            aro.x = x0;
            aro.y = y0;
            aro.text = "A";
            aro.ax = opts.ax;
            aro.ay = opts.ay;
            aro.axref = opts.axref;
            aro.ayref = opts.ayref;
            aro.showarrow = true;
            aro.arrowhead = 0;
            aro.arrowcolor = color;
            break;
        case 'image':
            aro.x = x0;
            aro.y = y0;
            aro.sizex = opts.sizex;
            aro.sizey = opts.sizey;
            aro.xanchor = opts.xanchor;
            aro.yanchor = opts.yanchor;
            aro.sizing = "stretch";
            aro.source = testImage;
            break;
        default:
            throw "Bad arotype: " + arotype;
    }
    return aro;
}

function setAxType(layout, axref, axtype) {
    axname = axisIds.id2name(axref);
    layout[axname].type = axtype;
}

// Calculate the ax value of an annotation given a particular desired scaling K
// This also works with log axes by taking logs of each part of the sum, so that
// the length in pixels is multiplied by the scalar
function annaxscale(ac, c0, K) {
    var ret;
    ret = c0 + 2 * (ac - c0);
    return ret;
}

// This tests to see that an annotation was drawn correctly.
// Determinining the length of the arrow seems complicated due to the
// rectangle containing the text, so we draw 2 annotations, one K times the
// length of the other, and solve for the desired arrow length from the
// length measured on the screen. This works because multiplying the length
// of the arrow doesn't change where the arrow meets the text box.
// xaxistype can be linear|log, only used if xref has type 'range' or 'domain',
// same for yaxistype and yref
function annotationTest(gd, layout, x0, y0, ax, ay, xref, yref, axref, ayref,
    xaxistype, yaxistype, xid, yid) {
    // Take the log of values corresponding to log axes.  This is because the
    // test is designed to make predicting the pixel positions easy, and it's
    // easiest when we work with the logarithm of values on log axes (doubling
    // the log value doubles the pixel value, etc.).
    var xreftype = Axes.getRefType(xref);
    var yreftype = Axes.getRefType(yref);
    var axreftype = Axes.getRefType(axref);
    var ayreftype = Axes.getRefType(ayref);
    x0 = xreftype === 'range' && xaxistype === 'log' ? Math.log10(x0) : x0;
    ax = axreftype === 'range' && xaxistype === 'log' ? Math.log10(ax) : ax;
    y0 = yreftype === 'range' && yaxistype === 'log' ? Math.log10(y0) : y0;
    ay = ayreftype === 'range' && yaxistype === 'log' ? Math.log10(ay) : ay;
    // if xref != axref or axref === 'pixel' then ax is a value relative to
    // x0 but in pixels. Same for yref
    var axpixels = false;
    if ((axreftype === 'pixel') || (axreftype != xreftype)) {
        axpixels = true;
    }
    var aypixels = false;
    if ((ayreftype === 'pixel') || (ayreftype != yreftype)) {
        aypixels = true;
    }
    var xaxname;
    var yaxname;
    logAxisIfAxType(gd.layout, layout, xid, xaxistype);
    logAxisIfAxType(gd.layout, layout, yid, yaxistype);
    var xpixels;
    var ypixels;
    var opts0 = {
        ax: ax,
        ay: ay,
        axref: axref,
        ayref: ayref,
    };
    var opts1 = {
        ax: axpixels ? 2 * ax : annaxscale(ax, x0, 2),
        ay: aypixels ? 2 * ay : annaxscale(ay, y0, 2),
        axref: axref,
        ayref: ayref,
    };
    // 2 colors so we can extract each annotation individually
    var color0 = 'rgb(10, 20, 30)';
    var color1 = 'rgb(10, 20, 31)';
    var anno0 = aroFromParams('annotation', x0, y0, xref, yref, color0, opts0);
    var anno1 = aroFromParams('annotation', x0, y0, xref, yref, color1, opts1);
    layout.annotations = [anno0, anno1];
    return Plotly.relayout(gd, layout)
        .then(function(gd) {
        // the choice of anno1 or anno0 is arbitrary
        var xabspixels = mapAROCoordToPixel(gd.layout, 'xref', anno1, 'x', 0, true);
        var yabspixels = mapAROCoordToPixel(gd.layout, 'yref', anno1, 'y', 0, true);
        if (axpixels) {
            // no need to map the specified values to pixels (because that's what
            // they are already)
            xpixels = ax;
        } else {
            xpixels = mapAROCoordToPixel(gd.layout, 'xref', anno0, 'ax', 0, true) -
                xabspixels;
        }
        if (aypixels) {
            // no need to map the specified values to pixels (because that's what
            // they are already)
            ypixels = ay;
        } else {
            ypixels = mapAROCoordToPixel(gd.layout, 'yref', anno0, 'ay', 0, true) -
                yabspixels;
        }
        var annobbox0 = getSVGElemScreenBBox(findAROByColor(color0));
        var annobbox1 = getSVGElemScreenBBox(findAROByColor(color1));
        // solve for the arrow length's x coordinate
        var arrowLenX = ((annobbox1.x + annobbox1.width) - (annobbox0.x + annobbox0
            .width));
        var arrowLenY;
        var yabspixelscmp;
        if (aypixels) {
            // for annotations whose arrows are specified in relative pixels,
            // positive pixel values on the y axis mean moving down the page like
            // SVG coordinates, so we have to add height
            var arrowLenY = (annobbox1.y + annobbox1.height) -
                (annobbox0.y + annobbox0.height);
            yabspixelscmp = annobbox0.y;
        } else {
            var arrowLenY = annobbox1.y - annobbox0.y;
            yabspixelscmp = annobbox0.y + annobbox0.height;
        }
        var ret = coordsEq(arrowLenX, xpixels) &&
            coordsEq(arrowLenY, ypixels) &&
            coordsEq(xabspixels, annobbox0.x) &&
            coordsEq(yabspixels, yabspixelscmp);
        return ret;
    });
}

// axid is e.g., 'x', 'y2' etc.
function logAxisIfAxType(layoutIn, layoutOut, axid, axtype) {
    var axname = axisIds.id2name(axid);
    if ((axtype === 'log') && (axid !== undefined)) {
        var axis = {
            ...layoutIn[axname]
        };
        axis.type = 'log';
        axis.range = axis.range.map(Math.log10);
        layoutOut[axname] = axis;
    }
}

// {layout} is required to map to pixels using its domain, range and size
// {axref} can be xref or yref
// {aro} is the components object where c and axref will be looked up
// {c} can be x0, x1, y0, y1
// {offset} allows adding something to the coordinate before converting, say if
// you want to map the point on the other side of a square
// {nolog} if set to true, the log of a range value will not be taken before
// computing its pixel position. This is useful for components whose positions
// are specified in log coordinates (i.e., images and annotations).
// You can tell I first wrote this function for shapes only and then learned
// later this was the case for images and annotations :').
function mapAROCoordToPixel(layout, axref, aro, c, offset, nolog) {
    var reftype = Axes.getRefType(aro[axref]);
    var axletter = axref[0];
    var ret;
    offset = (offset === undefined) ? 0 : offset;
    var val = aro[c] + offset;
    if (reftype === 'range') {
        var axis = axisIds.id2name(aro[axref]);
        ret = pixelCalc.mapRangeToPixel(layout, axis, val, nolog);
    } else if (reftype === 'domain') {
        var axis = axisIds.id2name(aro[axref]);
        ret = pixelCalc.mapDomainToPixel(layout, axis, val);
    } else if (reftype === 'paper') {
        var axis = axref[0];
        ret = pixelCalc.mapPaperToPixel(layout, axis, val);
    }
    return ret;
}

// compute the bounding box of the shape so that it can be compared with the SVG
// bounding box
function shapeToBBox(layout, aro) {
    var bbox = {};
    var x1;
    var y1;
    // map x coordinates
    bbox.x = mapAROCoordToPixel(layout, 'xref', aro, 'x0');
    x1 = mapAROCoordToPixel(layout, 'xref', aro, 'x1');
    // SVG bounding boxes have x,y referring to top left corner, but here we are
    // specifying aros where y0 refers to the bottom left corner like
    // Plotly.js, so we swap y0 and y1
    bbox.y = mapAROCoordToPixel(layout, 'yref', aro, 'y1');
    y1 = mapAROCoordToPixel(layout, 'yref', aro, 'y0');
    bbox.width = x1 - bbox.x;
    bbox.height = y1 - bbox.y;
    return bbox;
}

function imageToBBox(layout, img) {
    var bbox = {};
    // these will be pixels from the bottom of the plot and will be manipulated
    // below to be compatible with the SVG bounding box
    var x0;
    var x1;
    var y0;
    var y1;
    switch (img.xanchor) {
        case 'left':
            x0 = mapAROCoordToPixel(layout, 'xref', img, 'x', undefined, true);
            x1 = mapAROCoordToPixel(layout, 'xref', img, 'x', img.sizex, true);
            break;
        case 'right':
            x0 = mapAROCoordToPixel(layout, 'xref', img, 'x', -img.sizex, true);
            x1 = mapAROCoordToPixel(layout, 'xref', img, 'x', undefined, true);
            break;
        case 'center':
            x0 = mapAROCoordToPixel(layout, 'xref', img, 'x', -img.sizex * 0.5, true);
            x1 = mapAROCoordToPixel(layout, 'xref', img, 'x', img.sizex * 0.5, true);
            break;
        default:
            throw 'Bad xanchor: ' + img.xanchor;
    }
    switch (img.yanchor) {
        case 'bottom':
            y0 = mapAROCoordToPixel(layout, 'yref', img, 'y', undefined, true);
            y1 = mapAROCoordToPixel(layout, 'yref', img, 'y', img.sizey, true);
            break;
        case 'top':
            y0 = mapAROCoordToPixel(layout, 'yref', img, 'y', -img.sizey, true);
            y1 = mapAROCoordToPixel(layout, 'yref', img, 'y', undefined, true);
            break;
        case 'middle':
            y0 = mapAROCoordToPixel(layout, 'yref', img, 'y', -img.sizey * 0.5, true);
            y1 = mapAROCoordToPixel(layout, 'yref', img, 'y', img.sizey * 0.5, true);
            break;
        default:
            throw 'Bad yanchor: ' + img.yanchor;
    }
    bbox.x = x0;
    bbox.width = x1 - x0;
    // done this way because the pixel value of y1 will be smaller than the
    // pixel value x0 if y1 > y0 (because of how SVG draws relative to the top
    // of the screen)
    bbox.y = y1;
    bbox.height = y0 - y1;
    return bbox;
}


function coordsEq(a, b) {
    return Math.abs(a - b) < EQUALITY_TOLERANCE;
}

function compareBBoxes(a, b) {
    return ['x', 'y', 'width', 'height'].map(
        (k, ) => coordsEq(a[k], b[k])).reduce(
        (l, r) => l && r,
        true);
}

function findAROByColor(color, id) {
    id = (id === undefined) ? '' : id + ' ';
    var selector = id + 'path';
    var ret = d3.selectAll(selector).filter(function() {
        return this.style.stroke === color;
    }).node();
    return ret;
}

function findImage(id) {
    id = (id === undefined) ? '' : id + ' ';
    var selector = id + 'g image';
    var ret = d3.select(selector).node();
    return ret;
}

function checkImage(layout, imageObj, imageBBox) {}

function imageTest(gd, layout, xaxtype, yaxtype, x, y, sizex, sizey, xanchor,
    yanchor, xref, yref, xid, yid) {
    console.log('running imageTest on ', gd);
    var image = {
        x: x,
        y: y,
        sizex: sizex,
        sizey: sizey,
        source: testImage,
        xanchor: xanchor,
        yanchor: yanchor,
        xref: xref,
        yref: yref,
        sizing: "stretch"
    };
    var xreftype = Axes.getRefType(xref);
    var yreftype = Axes.getRefType(yref);
    var ret;
    // we pass xid, yid because we possibly want to change some axes to log,
    // even if we refer to paper in the end
    logAxisIfAxType(gd.layout, layout, xid, xaxtype);
    logAxisIfAxType(gd.layout, layout, yid, yaxtype);
    layout.images = [image];
    return Plotly.relayout(gd, layout)
        .then(function(gd) {
            var imageElem = findImage("#" + gd.id);
            var svgImageBBox = getSVGElemScreenBBox(imageElem);
            var imageBBox = imageToBBox(gd.layout, image);
            ret = compareBBoxes(svgImageBBox, imageBBox);
            //if (!ret) {
            //    throw 'test failed';
            //}
            return ret;
        });
}

// gets the SVG bounding box of the aro and checks it against what mapToPixel
// gives
function checkAROPosition(gd, aro) {
    var aroPath = findAROByColor(aro.line.color, "#" + gd.id);
    var aroPathBBox = getSVGElemScreenBBox(aroPath);
    var aroBBox = shapeToBBox(gd.layout, aro);
    var ret = compareBBoxes(aroBBox, aroPathBBox);
    if (DEBUG) {
        console.log('SVG BBox', aroPathBBox);
        console.log('aro BBox', aroBBox);
    }
    return ret;
}

// some made-up values for testing
// NOTE: The pixel values are intentionally set so that 2*pixel is never greater
// than the mock's margin. This is so that annotations are not unintentionally
// clipped out because they exceed the plotting area. The reason for using twice
// the pixel value is because the annotation test requires plotting 2
// annotations, the second having arrow components twice as long as the first.
var aroPositionsX = [{
        // aros referring to data
        ref: 'range',
        value: [2, 3],
        // for objects that need a size (i.e., images)
        size: 1.5,
        // for the case when annotations specifies arrow in pixels, this value
        // is read instead of value[1]
        pixel: 25
    },
    {
        // aros referring to domains
        ref: 'domain',
        value: [0.2, 0.75],
        size: 0.3,
        pixel: 30
    },
    {
        // aros referring to paper
        ref: 'paper',
        value: [0.25, 0.8],
        size: 0.35,
        pixel: 35
    },
];
var aroPositionsY = [{
        // aros referring to data
        ref: 'range',
        // two values for rects
        value: [1, 2],
        pixel: 30,
        size: 1.2
    },
    {
        // aros referring to domains
        ref: 'domain',
        value: [0.25, 0.7],
        pixel: 40,
        size: .2
    },
    {
        // aros referring to paper
        ref: 'paper',
        value: [0.2, 0.85],
        pixel: 45,
        size: .3
    }
];

var aroTypes = ['shape', 'annotation', 'image'];
var axisTypes = ['linear', 'log'];
// Test on 'x', 'y', 'x2', 'y2' axes
// TODO the 'paper' position references are tested twice when once would
// suffice.
var axisPairs = [
    ['x', 'y'],
    ['x2', 'y'],
    ['x', 'y2'],
    ['x2', 'y2']
];
// For annotations: if arrow coordinate is in the same coordinate system 's', if
// pixel then 'p'
var arrowAxis = [
    ['s', 's'],
    ['p', 's'],
    ['s', 'p'],
    ['p', 'p']
];
// only test the shapes line and rect for now
var shapeType = ['line', 'rect'];
// anchor positions for images
var xAnchors = ['left', 'center', 'right'];
var yAnchors = ['top', 'middle', 'bottom'];
// this color chosen so it can easily be found with d3
// NOTE: for images color cannot be set but it will be the only image in the
// plot so you can use d3.select('g image').node()
var aroColor = 'rgb(50, 100, 150)';
var testDomRefAROCombo = function(combo) {
    var xAxNum = combo[0];
    var xaxisType = combo[1];
    var xaroPos = combo[2];
    var yAxNum = combo[3];
    var yaxisType = combo[4];
    var yaroPos = combo[5];
    var aroType = combo[6];
    it('should draw a ' + aroType +
        ' for x' + xAxNum + ' of type ' +
        xaxisType +
        ' with a value referencing ' +
        xaroPos.ref +
        ' and for y' + yAxNum + ' of type ' +
        yaxisType +
        ' with a value referencing ' +
        yaroPos.ref,
        function(done) {
            var gd = createGraphDiv();
            var mock = testMock;
            if (DEBUG) {
                console.log(combo);
            }
            Plotly.newPlot(gd, mock)
            var aro = {
                type: aroType,
                line: {
                    color: aroColor
                }
            };
            aroFromAROPos(aro, 'x', xAxNum, xaroPos);
            aroFromAROPos(aro, 'y', yAxNum, yaroPos);
            var layout = {
                shapes: [aro]
            };
            // change to log axes if need be
            logAxisIfAxType(gd.layout, layout, 'x' + xAxNum, xaxisType);
            logAxisIfAxType(gd.layout, layout, 'y' + yAxNum, yaxisType);
            Plotly.relayout(gd, layout);
            console.log(checkAROPosition(gd, aro));
            destroyGraphDiv();
        });
}

// Test correct aro positions
function test_correct_aro_positions() {
    // for both x and y axes
    var testCombos = [...iterable.cartesianProduct([
        axNum, axisTypes, aroPositionsX, axNum, axisTypes,
        aroPositionsY, aroType
    ])];
    // map all the combinations to a aro definition and check this aro is
    // placed properly
    testCombos.forEach(testDomRefAROCombo);
}

function runComboTests(productItems, testCombo, start_stop, filter, keep_graph_div) {
    var testCombos = [...iterable.cartesianProduct(productItems)];
    testCombos = testCombos.map((c, i) => c.concat(['graph-' + i]));
    if (filter) {
        testCombos = testCombos.filter(filter);
    }
    if (start_stop) {
        testCombos = testCombos.slice(start_stop.start, start_stop.stop);
    }
    console.log("Executing " + testCombos.length + " tests");
    var tc = testCombos.map(c => testCombo(c, keep_graph_div)).reduce((a, v) => a.then(v));
}

function testImageCombo(combo, keep_graph_div) {
    var axistypex = combo[0];
    var axistypey = combo[1];
    var axispair = combo[2];
    var aroposx = combo[3];
    var aroposy = combo[4];
    var xanchor = combo[5];
    var yanchor = combo[6];
    var gd_id = combo[7];
    var xid = axispair[0];
    var yid = axispair[1];
    var xref = makeAxRef(xid, aroposx.ref);
    var yref = makeAxRef(yid, aroposy.ref);
    if (DEBUG) {
        console.log(combo);
    }
    return new Promise(function(resolve) {
            var gd = createGraphDiv(gd_id);
            resolve(gd);
        }).then(function(gd) {
            return Plotly.newPlot(gd, testMock);
        })
        .then(function(gd) {
            return imageTest(gd, {}, axistypex, axistypey,
                aroposx.value[0], aroposy.value[0], aroposx.size,
                aroposy.size,
                xanchor, yanchor, xref, yref, xid, yid);
        }).then(function(test_ret) {
            console.log([
                "Testing layout image with parameters:",
                "x-axis type:", axistypex, "\n",
                "y-axis type:", axistypey, "\n",
                "xanchor:", xanchor, "\n",
                "yanchor:", yanchor, "\n",
                "xref:", xref, "\n",
                "yref:", yref, "\n",
            ].join(' '), test_ret);
        }).then(function() {
            if (!keep_graph_div) {
                console.log('destroying graph div ', gd_id);
                Plotly.purge(gd_id);
                destroyGraphDiv(gd_id);
            }
        });
}

function runImageTests(start_stop, filter) {
    runComboTests([
        axisTypes, axisTypes, axisPairs,
        // axis reference types are contained in here
        aroPositionsX, aroPositionsY,
        xAnchors, yAnchors
    ], testImageCombo, start_stop, filter);
}

function describeAnnotationComboTest(combo) {
    var axistypex = combo[0];
    var axistypey = combo[1];
    var axispair = combo[2];
    var aroposx = combo[3];
    var aroposy = combo[4];
    var arrowaxispair = combo[5];
    var gd_id = combo[6];
    var xid = axispair[0];
    var yid = axispair[1];
    var xref = makeAxRef(xid, aroposx.ref);
    var yref = makeAxRef(yid, aroposy.ref);
    return [
        "should create a plot with graph ID",
        gd_id,
        " with parameters:", "\n",
        "x-axis type:", axistypex, "\n",
        "y-axis type:", axistypey, "\n",
        "axis pair:", axispair, "\n",
        "ARO position x:", aroposx, "\n",
        "ARO position y:", aroposy, "\n",
        "arrow axis pair:", arrowaxispair, "\n",
        "xref:", xref, "\n",
        "yref:", yref, "\n",
    ].join(' ');
}

function testAnnotationCombo(combo, assert, gd) {
    var axistypex = combo[0];
    var axistypey = combo[1];
    var axispair = combo[2];
    var aroposx = combo[3];
    var aroposy = combo[4];
    var arrowaxispair = combo[5];
    var gd_id = combo[6];
    var xid = axispair[0];
    var yid = axispair[1];
    var xref = makeAxRef(xid, aroposx.ref);
    var yref = makeAxRef(yid, aroposy.ref);
    var axref = arrowaxispair[0] === 'p' ? 'pixel' : xref;
    var ayref = arrowaxispair[1] === 'p' ? 'pixel' : yref;
    var x0 = aroposx.value[0];
    var y0 = aroposy.value[0];
    var ax = axref === 'pixel' ? aroposx.pixel : aroposx.value[1];
    var ay = ayref === 'pixel' ? aroposy.pixel : aroposy.value[1];
    return Plotly.newPlot(gd, testMock)
        .then(function(gd) {
            return annotationTest(gd, {}, x0, y0, ax, ay, xref, yref, axref,
                ayref, axistypex, axistypey, xid, yid);
        }).then(function(test_ret) {
            assert(test_ret);
        })
}

// return a list of functions, each returning a promise that executes a
// particular test. This function takes the keepGraphDiv argument, which if true
// will prevent destroying the generated graph after the test is executed, and
// an assert argument, which is a function that will be passed true if the test
// passed.
// {testCombos} is a list of combinations each of which will be passed to the
// test function
// {test} is the function returning a Promise that executes this test
function comboTests(testCombos,test) {
    var ret = testCombos.map(function (combo) {
        return function (assert, gd) {
            return test(combo, assert, gd);
        }
    });
    return ret;
}

// return a list of strings, each describing a corresponding test
// describe is a function taking a combination and returning a description of
// the test
function comboTestDescriptions(testCombos,desribe) {
    var ret = testCombos.map(desribe);
    return ret;
}

function annotationTestCombos() {
    var testCombos = [...iterable.cartesianProduct([
            axisTypes, axisTypes, axisPairs, aroPositionsX, aroPositionsY, arrowAxis
        ]
    )];
    testCombos = testCombos.map((c, i) => c.concat(['graph-' + i]));
    return testCombos;
}

function annotationTests() {
    var testCombos = annotationTestCombos();
    return comboTests(testCombos,testAnnotationCombo);
}

function annotationTestDescriptions() {
    var testCombos = annotationTestCombos();
    return comboTestDescriptions(testCombos,describeAnnotationComboTest);
}

module.exports = {
    // tests
    annotations: {
        descriptions: annotationTestDescriptions,
        tests: annotationTests,
    },
    // utilities
    findAROByColor: findAROByColor
};